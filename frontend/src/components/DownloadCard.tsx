import { useState } from "react";
import { Link } from "react-router-dom";
import { displayName, type Download } from "../lib/api";
import { formatBytes, formatDuration } from "../lib/format";
import { useDownloadActions } from "../lib/hooks";
import ProgressBar from "./ProgressBar";
import { Card, ModelAvatar } from "./ui";
import { IconAlert, IconBox, IconCheck, IconChevronDown, IconFolder, IconPause, IconPlay, IconRefresh, IconTrash } from "./icons";

const statusStyle: Record<string, { cls: string; dot: string; glow: string }> = {
  downloading: { cls: "bg-sky-500/10 text-sky-300 ring-sky-500/20", dot: "bg-sky-400 animate-pulse", glow: "bg-sky-500/10" },
  verifying: { cls: "bg-violet-500/10 text-violet-300 ring-violet-500/20", dot: "bg-violet-400 animate-pulse", glow: "bg-violet-500/10" },
  paused: { cls: "bg-amber-500/10 text-amber-300 ring-amber-500/20", dot: "bg-amber-400", glow: "bg-amber-500/[0.07]" },
  completed: { cls: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/20", dot: "bg-emerald-400", glow: "bg-emerald-500/10" },
  installing: { cls: "bg-violet-500/10 text-violet-300 ring-violet-500/20", dot: "bg-violet-400 animate-pulse", glow: "bg-violet-500/10" },
  installed: { cls: "bg-white/5 text-zinc-300 ring-white/10", dot: "bg-zinc-400", glow: "bg-white/[0.03]" },
  error: { cls: "bg-red-500/10 text-red-300 ring-red-500/20", dot: "bg-red-400", glow: "bg-red-500/[0.08]" },
};

export function StatusBadge({ label }: { label: string }) {
  const s = statusStyle[label] ?? statusStyle.installed;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ring-1 ring-inset ${s.cls}`}>
      <span className={`size-1.5 rounded-full ${s.dot}`} />
      {label === "completed" ? "ready to install" : label}
    </span>
  );
}

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent);
const btn = "inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition disabled:opacity-50";
const ghost = `${btn} border border-white/10 bg-white/5 hover:bg-white/10`;

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-0.5 truncate font-mono text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

function Files({ blobs }: { blobs: NonNullable<Download["blobs"]> }) {
  const [open, setOpen] = useState(false);
  const done = blobs.filter((b) => b.done).length;
  const sorted = [...blobs].sort((a, b) => b.size - a.size);
  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-white/[0.06]">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-3 py-2 text-left text-xs text-zinc-400 hover:bg-white/[0.03]">
        <span>Files · {done}/{blobs.length} done</span>
        <IconChevronDown className={`transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul className="divide-y divide-white/[0.04] border-t border-white/[0.06]">
          {sorted.map((b) => {
            const kind = b.mediaType.includes("container.image") ? "config" : b.mediaType.slice(b.mediaType.lastIndexOf(".") + 1) || "file";
            const pct = b.done ? 1 : b.size ? b.downloaded / b.size : 0;
            return (
              <li key={b.digest} className="flex items-center gap-3 px-3 py-2 text-xs">
                <span className="w-20 shrink-0 font-medium capitalize text-zinc-300">{kind}</span>
                <span className="hidden w-24 shrink-0 font-mono text-zinc-500 sm:inline">{b.digest.slice(7, 19)}</span>
                <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                  <div className={`h-full rounded-full ${b.done ? "bg-emerald-500" : "bg-sky-400"}`} style={{ width: `${pct * 100}%` }} />
                </div>
                <span className="w-16 shrink-0 text-right font-mono text-zinc-400">{formatBytes(b.size)}</span>
                <span className="w-4 shrink-0 text-emerald-400">{b.done && <IconCheck />}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function DownloadCard({ d, compact }: { d: Download; compact?: boolean }) {
  const a = useDownloadActions();
  const progress = d.totalBytes ? d.downloadedBytes / d.totalBytes : 0;
  const speed = d.live?.speed ?? 0;
  const eta = speed > 0 ? (d.totalBytes - d.downloadedBytes) / speed : NaN;
  const reconnecting = d.live && d.live.retries > 0 && speed < 1024 && d.live.lastError;
  const label = d.live?.phase === "verifying" ? "verifying" : d.status;
  const tone = d.status === "error" ? "red" : d.status === "paused" ? "amber" : d.status === "installed" ? "zinc" : "emerald";
  const busy = a.pause.isPending || a.resume.isPending || a.install.isPending || a.remove.isPending;
  const name = `${displayName(d.model)}:${d.tag}`;
  const downloading = d.status === "downloading";

  const actions = (
    <>
      {downloading && (
        <button disabled={busy} onClick={() => a.pause.mutate(d.id)} className={ghost}>
          <IconPause /> Pause
        </button>
      )}
      {(d.status === "paused" || d.status === "error") && (
        <button disabled={busy} onClick={() => a.resume.mutate(d.id)} className={`${btn} bg-sky-500 text-white shadow-lg shadow-sky-500/20 hover:bg-sky-400`}>
          <IconPlay /> Resume
        </button>
      )}
      {d.status === "completed" && (
        <button disabled={busy} onClick={() => a.install.mutate(d.id)} className={`${btn} bg-gradient-to-r from-emerald-400 to-teal-500 text-zinc-950 shadow-lg shadow-emerald-500/25 hover:brightness-110`}>
          <IconBox /> Install to Ollama
        </button>
      )}
      {d.status !== "installing" && (
        <button disabled={a.reveal.isPending} title={isMac ? "Show in Finder" : "Show in folder"} onClick={() => a.reveal.mutate(d.id)} className={`${ghost} ${compact ? "px-2.5" : ""}`}>
          <IconFolder />
          {!compact && (isMac ? "Finder" : "Folder")}
        </button>
      )}
    </>
  );

  const alerts = (
    <>
      {reconnecting && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
          <IconRefresh className="mt-0.5 shrink-0 animate-spin [animation-duration:2s]" />
          <span>Connection problem — retrying automatically ({d.live!.retries} retries). {d.live!.lastError}</span>
        </div>
      )}
      {d.error && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          <IconAlert className="mt-0.5 shrink-0" />
          <span>{d.error}</span>
        </div>
      )}
    </>
  );

  if (compact) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-black/20 p-4">
        <div className="flex items-end justify-between gap-3">
          <div className="font-mono text-2xl font-semibold tracking-tight text-white">
            {(progress * 100).toFixed(1)}
            <span className="text-base text-zinc-500">%</span>
          </div>
          <StatusBadge label={label} />
        </div>
        <div className="mt-2"><ProgressBar value={progress} active={downloading} tone={tone} /></div>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div className="flex gap-6 font-mono text-sm text-zinc-200">
            <span>{formatBytes(d.downloadedBytes)} / {formatBytes(d.totalBytes)}</span>
            {downloading && <span>{formatBytes(speed)}/s · {formatDuration(eta)}</span>}
          </div>
          <div className="flex gap-2">{actions}</div>
        </div>
        {alerts}
      </div>
    );
  }

  const s = statusStyle[label] ?? statusStyle.installed;
  return (
    <Card className="relative overflow-hidden p-5 sm:p-6">
      <div className={`pointer-events-none absolute -top-20 -right-20 size-56 rounded-full blur-3xl ${s.glow}`} />

      <div className="relative flex items-start gap-4">
        <ModelAvatar name={d.model} />
        <div className="min-w-0 flex-1">
          <Link to={`/m/${d.model}`} className="block truncate text-lg font-semibold tracking-tight transition hover:text-emerald-400">{name}</Link>
          <div className="mt-0.5 truncate text-xs text-zinc-500">Added {new Date(d.createdAt).toLocaleString()}</div>
        </div>
        <StatusBadge label={label} />
      </div>

      <div className="relative mt-5 flex items-end justify-between gap-3">
        <div className="font-mono text-4xl font-semibold tracking-tight text-white">
          {(progress * 100).toFixed(1)}
          <span className="text-lg text-zinc-500">%</span>
        </div>
        <div className="text-right font-mono text-sm text-zinc-400">
          {formatBytes(d.downloadedBytes)} <span className="text-zinc-600">/</span> {formatBytes(d.totalBytes)}
        </div>
      </div>
      <div className="relative mt-3"><ProgressBar value={progress} active={downloading} tone={tone} /></div>

      {downloading && (
        <div className="relative mt-4 grid grid-cols-3 gap-2">
          <Spec label="Speed" value={`${formatBytes(speed)}/s`} />
          <Spec label="Time left" value={formatDuration(eta)} />
          <Spec label="Left" value={formatBytes(Math.max(0, d.totalBytes - d.downloadedBytes))} />
        </div>
      )}

      <div className="relative">
        {alerts}
        {d.blobs && d.blobs.length > 1 && <Files blobs={d.blobs} />}
      </div>

      <div className="relative mt-5 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-4">
        {actions}
        {d.status !== "installing" && (
          <button
            disabled={busy}
            title="Cancel and delete the downloaded data"
            onClick={() => confirm("Cancel and delete the downloaded data?") && a.remove.mutate(d.id)}
            className={`${btn} ml-auto px-2.5 text-zinc-500 hover:bg-red-500/10 hover:text-red-300`}
          >
            <IconTrash />
          </button>
        )}
      </div>
    </Card>
  );
}
