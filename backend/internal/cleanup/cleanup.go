// Package cleanup finds disk space that can be reclaimed: leftover staging
// folders, temp files, blobs no manifest references and models nobody uses.
package cleanup

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/dagdan/ai-model-downloader/internal/installer"
	"github.com/dagdan/ai-model-downloader/internal/store"
)

const (
	CategoryStaging = "staging"
	CategoryOrphan  = "orphan"
	CategoryUnused  = "unused"

	KindStaging  = "staging"  // staging folder with no download behind it
	KindDownload = "download" // unfinished download nobody touched for a while
	KindTemp     = "temp"     // interrupted write left in Ollama's store
	KindBlob     = "blob"
	KindModel    = "model"

	// Files younger than this may still be in use by Ollama or an install.
	settleTime = time.Hour
	// Ollama resumes its own partial pulls, so give them longer.
	partialSettleTime = 24 * time.Hour
	StaleDownload     = 7 * 24 * time.Hour
)

var downloadState = map[string]string{
	store.StatusPaused:    "Paused download",
	store.StatusError:     "Failed download",
	store.StatusCompleted: "Downloaded but never installed",
}

var (
	blobFile    = regexp.MustCompile(`^sha256-[0-9a-f]{64}$`)
	partialFile = regexp.MustCompile(`^sha256-[0-9a-f]{64}(-partial(-\d+)?|\.partial-install)$`)
)

type Item struct {
	ID         string     `json:"id"`
	Category   string     `json:"category"`
	Kind       string     `json:"kind"`
	Name       string     `json:"name"`
	Detail     string     `json:"detail"`
	Bytes      int64      `json:"bytes"`
	ModifiedAt time.Time  `json:"modifiedAt"`
	LastUsed   *time.Time `json:"lastUsed,omitempty"`

	path       string
	model, tag string
	downloadID int64
}

type Input struct {
	ModelsDir  string
	StagingDir string
	Host       string
	Downloads  []store.Download
	Active     func(id int64) bool
	// Keep lists blobs unfinished downloads or transfer folders still rely on.
	Keep map[string]bool
	// LastUsed is when each namespace/model:tag was last seen loaded in Ollama.
	LastUsed    map[string]time.Time
	Loaded      map[string]bool
	UnusedAfter time.Duration
	Now         time.Time
}

// Scan lists everything that can be cleaned up, largest first within each category.
func Scan(in Input) []Item {
	refs := installer.BlobRefs(in.ModelsDir)
	items := scanStaging(in)
	items = append(items, scanBlobs(in, refs)...)
	items = append(items, scanManifestTemps(in)...)
	items = append(items, scanUnused(in, refs)...)
	sort.SliceStable(items, func(i, k int) bool {
		if items[i].Category != items[k].Category {
			return items[i].Category < items[k].Category
		}
		return items[i].Bytes > items[k].Bytes
	})
	return items
}

func scanStaging(in Input) []Item {
	byID := map[int64]store.Download{}
	for _, d := range in.Downloads {
		byID[d.ID] = d
	}
	var out []Item
	entries, _ := os.ReadDir(in.StagingDir)
	for _, e := range entries {
		fi, err := e.Info()
		if err != nil || in.Now.Sub(fi.ModTime()) < settleTime {
			continue
		}
		p := filepath.Join(in.StagingDir, e.Name())
		it := Item{Category: CategoryStaging, Kind: KindStaging, Name: e.Name(), ModifiedAt: fi.ModTime(), Bytes: size(p), path: p}
		id, err := strconv.ParseInt(e.Name(), 10, 64)
		d, known := byID[id]
		switch {
		case err != nil || !known:
			it.Detail = "Left behind by a download that no longer exists"
		case d.Status == store.StatusInstalled:
			it.Name = d.Model + ":" + d.Tag
			it.Detail = "Leftover files from an install that already finished"
		case d.Status == store.StatusDownloading || d.Status == store.StatusInstalling || in.Active(id):
			continue
		case downloadState[d.Status] == "" || in.Now.Sub(d.UpdatedAt) < StaleDownload:
			continue
		default:
			it.Kind, it.downloadID = KindDownload, id
			it.Name = d.Model + ":" + d.Tag
			it.ModifiedAt = d.UpdatedAt
			it.Detail = fmt.Sprintf("%s, untouched for %d days", downloadState[d.Status], int(in.Now.Sub(d.UpdatedAt).Hours()/24))
		}
		if it.Bytes == 0 && it.Kind == KindDownload {
			continue
		}
		it.ID = it.Kind + ":" + e.Name()
		out = append(out, it)
	}
	return out
}

func scanBlobs(in Input, refs map[string]int) []Item {
	dir := filepath.Join(in.ModelsDir, "blobs")
	entries, _ := os.ReadDir(dir)
	var out []Item
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		fi, err := e.Info()
		if err != nil {
			continue
		}
		age := in.Now.Sub(fi.ModTime())
		name := e.Name()
		switch {
		case blobFile.MatchString(name):
			digest := strings.Replace(name, "-", ":", 1)
			if refs[digest] > 0 || in.Keep[digest] || age < settleTime {
				continue
			}
			out = append(out, Item{ID: KindBlob + ":" + digest, Category: CategoryOrphan, Kind: KindBlob, Name: digest,
				Detail: "No installed model uses this file", Bytes: fi.Size(), ModifiedAt: fi.ModTime(), path: filepath.Join(dir, name)})
		case partialFile.MatchString(name):
			settle := settleTime
			if strings.Contains(name, "-partial") {
				settle = partialSettleTime
			}
			if age < settle {
				continue
			}
			out = append(out, Item{ID: KindTemp + ":blobs/" + name, Category: CategoryStaging, Kind: KindTemp, Name: name,
				Detail: "Interrupted download or install inside Ollama's store", Bytes: fi.Size(), ModifiedAt: fi.ModTime(), path: filepath.Join(dir, name)})
		}
	}
	return out
}

func scanManifestTemps(in Input) []Item {
	var out []Item
	root := filepath.Join(in.ModelsDir, "manifests")
	_ = filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(p, ".tmp") {
			return nil
		}
		fi, err := d.Info()
		if err != nil || in.Now.Sub(fi.ModTime()) < settleTime {
			return nil
		}
		rel, _ := filepath.Rel(in.ModelsDir, p)
		out = append(out, Item{ID: KindTemp + ":" + filepath.ToSlash(rel), Category: CategoryStaging, Kind: KindTemp, Name: filepath.ToSlash(rel),
			Detail: "Unfinished manifest write", Bytes: fi.Size(), ModifiedAt: fi.ModTime(), path: p})
		return nil
	})
	return out
}

func scanUnused(in Input, refs map[string]int) []Item {
	var out []Item
	for _, m := range installer.InstalledModels(in.ModelsDir, in.Host) {
		if in.Loaded[m.Name] {
			continue
		}
		man, err := installer.LocalManifest(in.ModelsDir, in.Host, m.Model, m.Tag)
		if err != nil {
			continue
		}
		last := m.ModifiedAt
		if t := in.LastUsed[m.Name]; t.After(last) {
			last = t
		}
		var freed int64
		seen := map[string]bool{}
		for _, l := range man.AllBlobs() {
			if seen[l.Digest] {
				continue
			}
			seen[l.Digest] = true
			fi, err := os.Stat(filepath.Join(in.ModelsDir, "blobs", installer.BlobFileName(l.Digest)))
			if err != nil {
				continue
			}
			if t := accessTime(fi); l.MediaType == "application/vnd.ollama.image.model" && t.After(last) && !t.After(in.Now) {
				last = t
			}
			if refs[l.Digest] <= 1 && !in.Keep[l.Digest] {
				freed += fi.Size()
			}
		}
		if in.Now.Sub(last) < in.UnusedAfter {
			continue
		}
		days := int(in.Now.Sub(last).Hours() / 24)
		out = append(out, Item{ID: KindModel + ":" + m.Name, Category: CategoryUnused, Kind: KindModel, Name: m.Name,
			Detail: fmt.Sprintf("Not used for %d days", days), Bytes: freed, ModifiedAt: m.ModifiedAt, LastUsed: &last, model: m.Model, tag: m.Tag})
	}
	return out
}

func size(p string) int64 {
	var total int64
	_ = filepath.WalkDir(p, func(_ string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			if fi, err := d.Info(); err == nil {
				total += fi.Size()
			}
		}
		return nil
	})
	return total
}

type Actions struct {
	RemoveModel    func(model, tag string) (int64, error)
	DeleteDownload func(id int64) error
}

type Result struct {
	FreedBytes int64    `json:"freedBytes"`
	Removed    int      `json:"removed"`
	Skipped    int      `json:"skipped"`
	Errors     []string `json:"errors"`
}

var kindOrder = map[string]int{KindModel: 0, KindDownload: 1, KindStaging: 2, KindTemp: 3, KindBlob: 4}

// Clean deletes the requested items. It scans again first and only touches
// items that are still eligible, so stale or forged IDs are skipped.
func Clean(in Input, ids []string, act Actions) Result {
	want := map[string]bool{}
	for _, id := range ids {
		want[id] = true
	}
	var todo []Item
	for _, it := range Scan(in) {
		if want[it.ID] {
			todo = append(todo, it)
		}
	}
	sort.SliceStable(todo, func(i, k int) bool { return kindOrder[todo[i].Kind] < kindOrder[todo[k].Kind] })

	res := Result{Errors: []string{}, Skipped: len(want) - len(todo)}
	for _, it := range todo {
		var err error
		freed := it.Bytes
		switch it.Kind {
		case KindModel:
			freed, err = act.RemoveModel(it.model, it.tag)
		case KindDownload:
			err = act.DeleteDownload(it.downloadID)
		case KindStaging:
			err = os.RemoveAll(it.path)
		default:
			err = os.Remove(it.path)
		}
		if err != nil {
			res.Errors = append(res.Errors, fmt.Sprintf("%s: %v", it.Name, err))
			continue
		}
		res.Removed++
		res.FreedBytes += freed
	}
	return res
}
