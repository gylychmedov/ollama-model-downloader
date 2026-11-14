package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	StatusDownloading = "downloading"
	StatusPaused      = "paused"
	StatusVerifying   = "verifying"
	StatusCompleted   = "completed"
	StatusInstalling  = "installing"
	StatusInstalled   = "installed"
	StatusError       = "error"
)

var ErrNotFound = errors.New("not found")

type Segment struct {
	Start int64 `json:"start"`
	End   int64 `json:"end"`
	Done  int64 `json:"done"`
}

type Blob struct {
	ID         int64     `json:"id"`
	DownloadID int64     `json:"-"`
	Digest     string    `json:"digest"`
	MediaType  string    `json:"mediaType"`
	Size       int64     `json:"size"`
	Downloaded int64     `json:"downloaded"`
	Done       bool      `json:"done"`
	Segments   []Segment `json:"-"`
}

type Download struct {
	ID         int64     `json:"id"`
	Model      string    `json:"model"`
	Tag        string    `json:"tag"`
	Status     string    `json:"status"`
	Manifest   string    `json:"-"`
	TotalBytes int64     `json:"totalBytes"`
	Downloaded int64     `json:"downloadedBytes"`
	Error      string    `json:"error"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
	Blobs      []Blob    `json:"blobs"`
}

type Store struct{ pool *pgxpool.Pool }

const schema = `
CREATE TABLE IF NOT EXISTS downloads (
	id          BIGSERIAL PRIMARY KEY,
	model       TEXT NOT NULL,
	tag         TEXT NOT NULL,
	status      TEXT NOT NULL,
	manifest    TEXT NOT NULL,
	total_bytes BIGINT NOT NULL,
	error       TEXT NOT NULL DEFAULT '',
	created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
	UNIQUE (model, tag)
);
CREATE TABLE IF NOT EXISTS blobs (
	id          BIGSERIAL PRIMARY KEY,
	download_id BIGINT NOT NULL REFERENCES downloads(id) ON DELETE CASCADE,
	digest      TEXT NOT NULL,
	media_type  TEXT NOT NULL,
	size        BIGINT NOT NULL,
	downloaded  BIGINT NOT NULL DEFAULT 0,
	segments    JSONB NOT NULL DEFAULT '[]',
	done        BOOLEAN NOT NULL DEFAULT false,
	UNIQUE (download_id, digest)
);
CREATE TABLE IF NOT EXISTS library_cache (
	key        TEXT PRIMARY KEY,
	data       JSONB NOT NULL,
	fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`

func Open(ctx context.Context, url string) (*Store, error) {
	var pool *pgxpool.Pool
	var err error
	for i := 0; i < 30; i++ {
		pool, err = pgxpool.New(ctx, url)
		if err == nil {
			if err = pool.Ping(ctx); err == nil {
				break
			}
			pool.Close()
		}
		time.Sleep(time.Second)
	}
	if err != nil {
		return nil, err
	}
	if _, err := pool.Exec(ctx, schema); err != nil {
		return nil, err
	}
	return &Store{pool: pool}, nil
}

func (s *Store) Close() { s.pool.Close() }

func (s *Store) CreateDownload(ctx context.Context, d *Download) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	err = tx.QueryRow(ctx,
		`INSERT INTO downloads (model, tag, status, manifest, total_bytes) VALUES ($1,$2,$3,$4,$5)
		 RETURNING id, created_at, updated_at`,
		d.Model, d.Tag, d.Status, d.Manifest, d.TotalBytes,
	).Scan(&d.ID, &d.CreatedAt, &d.UpdatedAt)
	if err != nil {
		return err
	}
	for i := range d.Blobs {
		b := &d.Blobs[i]
		segs, _ := json.Marshal(b.Segments)
		err = tx.QueryRow(ctx,
			`INSERT INTO blobs (download_id, digest, media_type, size, downloaded, segments, done)
			 VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (download_id, digest) DO UPDATE SET size = EXCLUDED.size RETURNING id`,
			d.ID, b.Digest, b.MediaType, b.Size, b.Downloaded, segs, b.Done,
		).Scan(&b.ID)
		if err != nil {
			return err
		}
		b.DownloadID = d.ID
	}
	return tx.Commit(ctx)
}

func (s *Store) FindByModelTag(ctx context.Context, model, tag string) (*Download, error) {
	var id int64
	err := s.pool.QueryRow(ctx, `SELECT id FROM downloads WHERE model=$1 AND tag=$2`, model, tag).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return s.Get(ctx, id)
}

func (s *Store) Get(ctx context.Context, id int64) (*Download, error) {
	list, err := s.list(ctx, `WHERE d.id = $1`, id)
	if err != nil {
		return nil, err
	}
	if len(list) == 0 {
		return nil, ErrNotFound
	}
	return &list[0], nil
}

func (s *Store) List(ctx context.Context) ([]Download, error) {
	return s.list(ctx, ``)
}

func (s *Store) ListByStatus(ctx context.Context, status string) ([]Download, error) {
	return s.list(ctx, `WHERE d.status = $1`, status)
}

func (s *Store) list(ctx context.Context, where string, args ...any) ([]Download, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT d.id, d.model, d.tag, d.status, d.manifest, d.total_bytes, d.error, d.created_at, d.updated_at,
		       b.id, b.digest, b.media_type, b.size, b.downloaded, b.segments, b.done
		FROM downloads d LEFT JOIN blobs b ON b.download_id = d.id `+where+`
		ORDER BY d.created_at DESC, b.id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Download
	idx := map[int64]int{}
	for rows.Next() {
		var d Download
		var bid *int64
		var digest, mt *string
		var size, downloaded *int64
		var segs []byte
		var done *bool
		if err := rows.Scan(&d.ID, &d.Model, &d.Tag, &d.Status, &d.Manifest, &d.TotalBytes, &d.Error, &d.CreatedAt, &d.UpdatedAt,
			&bid, &digest, &mt, &size, &downloaded, &segs, &done); err != nil {
			return nil, err
		}
		i, ok := idx[d.ID]
		if !ok {
			d.Blobs = []Blob{}
			out = append(out, d)
			i = len(out) - 1
			idx[d.ID] = i
		}
		if bid != nil {
			b := Blob{ID: *bid, DownloadID: d.ID, Digest: *digest, MediaType: *mt, Size: *size, Downloaded: *downloaded, Done: *done}
			_ = json.Unmarshal(segs, &b.Segments)
			out[i].Blobs = append(out[i].Blobs, b)
			out[i].Downloaded += b.Downloaded
		}
	}
	return out, rows.Err()
}

func (s *Store) SetStatus(ctx context.Context, id int64, status, errMsg string) error {
	_, err := s.pool.Exec(ctx, `UPDATE downloads SET status=$2, error=$3, updated_at=now() WHERE id=$1`, id, status, errMsg)
	return err
}

func (s *Store) SaveBlobProgress(ctx context.Context, b *Blob) error {
	segs, _ := json.Marshal(b.Segments)
	_, err := s.pool.Exec(ctx, `UPDATE blobs SET downloaded=$2, segments=$3, done=$4 WHERE id=$1`, b.ID, b.Downloaded, segs, b.Done)
	return err
}

func (s *Store) Delete(ctx context.Context, id int64) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM downloads WHERE id=$1`, id)
	return err
}

func (s *Store) CacheGet(ctx context.Context, key string) ([]byte, time.Time, bool) {
	var data []byte
	var at time.Time
	err := s.pool.QueryRow(ctx, `SELECT data, fetched_at FROM library_cache WHERE key=$1`, key).Scan(&data, &at)
	return data, at, err == nil
}

func (s *Store) CacheSet(ctx context.Context, key string, data []byte) {
	_, _ = s.pool.Exec(ctx, `INSERT INTO library_cache (key, data) VALUES ($1,$2)
		ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, fetched_at = now()`, key, data)
}
