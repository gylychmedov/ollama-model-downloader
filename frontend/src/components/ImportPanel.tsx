import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { uploadTransferFile } from "../lib/api";
import { formatBytes } from "../lib/format";
import { useTransferActions } from "../lib/hooks";
import ProgressBar from "./ProgressBar";
import { Card } from "./ui";
import { IconCheck, IconCopy, IconFolder, IconUpload, IconUsb } from "./icons";

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent);

type Item = { pkg: string; path: string; file: File };

/**
 * Finds model files in a folder picked with <input webkitdirectory>. The user may
 * pick the model folder itself or a parent (e.g. a USB drive with several models):
 * the folder right above "blobs"/"manifests" is the package.
 */
function collect(files: FileList): Item[] {
  const items: Item[] = [];
  const readmes: { dir: string; file: File }[] = [];
  const packages = new Set<string>();
  for (const file of Array.from(files)) {
    const parts = file.webkitRelativePath.split("/");
    const last = parts.length - 1;
    for (let i = 1; i < parts.length; i++) {
      const isBlob = parts[i] === "blobs" && i === last - 1 && /^sha256-[0-9a-f]{64}$/.test(parts[last]);
      const isManifest = parts[i] === "manifests" && i === last - 4;
      if (isBlob || isManifest) {
        const pkg = parts[i - 1].replace(/[^\w.-]+/g, "-").replace(/^[^\w]+/, "") || "model";
        packages.add(pkg);
        items.push({ pkg, path: parts.slice(i).join("/"), file });
        break;
      }
    }
    if (parts[last] === "README.txt" && last >= 1) readmes.push({ dir: parts[last - 1], file });
  }
  for (const r of readmes) {
    const pkg = r.dir.replace(/[^\w.-]+/g, "-").replace(/^[^\w]+/, "");
    if (packages.has(pkg)) items.push({ pkg, path: "README.txt", file: r.file });
  }
  // Manifests first so the folder shows up right away with its expected size.
  return items.sort((a, b) => Number(a.path.startsWith("blobs/")) - Number(b.path.startsWith("blobs/")));
}

export default function ImportPanel({ dir }: { dir?: string }) {
  const a = useTransferActions();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const [upload, setUpload] = useState<{ done: number; total: number; name: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    input.current?.setAttribute("webkitdirectory", "");
  }, []);

  const onPick = async (files: FileList | null) => {
    if (!files?.length) return;
    const items = collect(files);
    if (input.current) input.current.value = "";
    if (!items.some((i) => i.path.startsWith("manifests/"))) {
      alert("This folder doesn't contain an Ollama model. Pick the folder that has the \"blobs\" and \"manifests\" folders inside.");
      return;
    }
    const total = items.reduce((s, i) => s + i.file.size, 0);
    const ctrl = new AbortController();
    abort.current = ctrl;
    let base = 0;
    setUpload({ done: 0, total, name: [...new Set(items.map((i) => i.pkg))].join(", ") });
    try {
      for (const it of items) {
        await uploadTransferFile(it.pkg, it.path, it.file, (loaded) => setUpload((u) => u && { ...u, done: base + loaded }), ctrl.signal);
        base += it.file.size;
        qc.invalidateQueries({ queryKey: ["transfers"] });
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") alert(`Copy failed: ${(e as Error).message}`);
    } finally {
      abort.current = null;
      setUpload(null);
      qc.invalidateQueries({ queryKey: ["transfers"] });
    }
  };

  const copyPath = async () => {
    if (!dir) return;
    try {
      await navigator.clipboard.writeText(dir);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      prompt("Copy this path:", dir);
    }
  };

  const btn = "inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition disabled:opacity-50";

  return (
    <Card className="relative overflow-hidden border-dashed p-5 sm:p-6">
      <div className="flex flex-wrap items-start gap-4">
        <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-indigo-500/10 text-lg text-indigo-300 ring-1 ring-inset ring-indigo-500/20">
          <IconUsb />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold tracking-tight">Install a model from another computer</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Paste a copied model folder into the transfer folder below — it appears here with an <b className="text-zinc-200">Install</b> button. If the
            folder is somewhere else (Desktop, USB drive), use <b className="text-zinc-200">Choose folder…</b>.
          </p>
          <div className="mt-3 flex min-w-0 items-center gap-2 rounded-xl border border-white/[0.06] bg-black/30 px-3 py-2">
            <IconFolder className="shrink-0 text-indigo-300" />
            <code className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-300" title={dir}>{dir ?? "…"}</code>
            <button onClick={copyPath} title="Copy path" className="shrink-0 text-zinc-500 transition hover:text-white">
              {copied ? <IconCheck className="text-emerald-400" /> : <IconCopy />}
            </button>
          </div>
        </div>
      </div>

      {upload ? (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between gap-3 text-xs text-zinc-400">
            <span className="truncate">Copying {upload.name}… {formatBytes(upload.done)} / {formatBytes(upload.total)}</span>
            <button onClick={() => abort.current?.abort()} className="shrink-0 text-zinc-500 hover:text-red-300">Cancel</button>
          </div>
          <ProgressBar value={upload.total ? upload.done / upload.total : 0} active />
        </div>
      ) : (
        <div className="mt-5 flex flex-wrap gap-2 border-t border-white/[0.06] pt-4">
          <button disabled={a.openDir.isPending} onClick={() => a.openDir.mutate()} className={`${btn} border border-white/10 bg-white/5 hover:bg-white/10`}>
            <IconFolder /> {isMac ? "Open in Finder" : "Open folder"}
          </button>
          <button onClick={() => input.current?.click()} className={`${btn} bg-indigo-500 text-[#fff] shadow-lg shadow-indigo-500/20 hover:bg-indigo-400`}>
            <IconUpload /> Choose folder…
          </button>
        </div>
      )}
      <input ref={input} type="file" multiple hidden onChange={(e) => onPick(e.target.files)} />
    </Card>
  );
}
