import { Link } from "react-router-dom";
import { displayName, type Download } from "../lib/api";
import { formatBytes, formatDuration } from "../lib/format";
import { useDownloadActions } from "../lib/hooks";
import ProgressBar from "./ProgressBar";
import { Card, ModelAvatar } from "./ui";
import { IconAlert, IconBox, IconFolder, IconPause, IconPlay, IconRefresh, IconTerminal, IconTrash } from "./icons";

const statusStyle: Record<string, { cls: string; dot: string }> = {
  downloading: { cls: "bg-sky-500/10 text-sky-300 ring-sky-500/20", dot: "bg-sky-400 animate-pulse" },
  verifying: { cls: "bg-violet-500/10 text-violet-300 ring-violet-500/20", dot: "bg-violet-400 animate-pulse" },
  paused: { cls: "bg-amber-500/10 text-amber-300 ring-amber-500/20", dot: "bg-amber-400" },
  completed: { cls: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/20", dot: "bg-emerald-400" },
  installing: { cls: "bg-violet-500/10 text-violet-300 ring-violet-500/20", dot: "bg-violet-400 animate-pulse" },
  installed: { cls: "bg-white/5 text-zinc-300 ring-white/10", dot: "bg-zinc-400" },
  error: { cls: "bg-red-500/10 text-red-300 ring-red-500/20", dot: "bg-red-400" },
};

function StatusBadge({ label }: { label: string }) {
  const s = statusStyle[label] ?? statusStyle.installed;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ring-1 ring-inset ${s.cls}`}>
      <span className={`size-1.5 rounded-full ${s.dot}`} />
      {label === "completed" ? "ready to install" : label}
    </span>
  );
}

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent);

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-0.5 font-mono text-sm text-zinc-200">{value}</div>
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

  const btn = "inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition disabled:opacity-50";

  const actions = (
    <div className="flex gap-2">
      {d.status === "downloading" && (
        <button disabled={busy} onClick={() => a.pause.mutate(d.id)} className={`${btn} border border-white/10 bg-white/5 hover:bg-white/10`}>
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
        <button
          disabled={a.reveal.isPending}
          title={isMac ? "Show in Finder" : "Show in folder"}
          onClick={() => a.reveal.mutate(d.id)}
          className={`${btn} ${compact ? "px-2.5" : ""} border border-white/10 bg-white/5 hover:bg-white/10`}
        >
          <IconFolder />
          {!compact && (isMac ? "Show in Finder" : "Show in folder")}
        </button>
      )}
      {d.status !== "installing" && !compact && (
        <button
          disabled={busy}
          title={d.status === "installed" ? "Clear from list" : "Delete download"}
          onClick={() => {
            const msg = d.status === "installed" ? "Remove this entry from the list? The installed model stays in Ollama." : "Cancel and delete the downloaded data?";
            if (confirm(msg)) a.remove.mutate(d.id);
          }}
          className={`${btn} px-2.5 text-zinc-500 hover:bg-red-500/10 hover:text-red-300`}
        >
          <IconTrash />
        </button>
      )}
    </div>
  );

  const body = (
    <>
      <div className="flex items-end justify-between gap-3">
        <div className="font-mono text-2xl font-semibold tracking-tight text-white">
          {(progress * 100).toFixed(1)}
          <span className="text-base text-zinc-500">%</span>
        </div>
        {compact && <StatusBadge label={label} />}
      </div>
      <div className="mt-2">
        <ProgressBar value={progress} active={d.status === "downloading"} tone={tone} />
      </div>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div className="flex gap-6">
          <Stat label="Size" value={`${formatBytes(d.downloadedBytes)} / ${formatBytes(d.totalBytes)}`} />
          {d.status === "downloading" && (
            <>
              <Stat label="Speed" value={`${formatBytes(speed)}/s`} />
              <Stat label="ETA" value={formatDuration(eta)} />
            </>
          )}
        </div>
        {actions}
      </div>

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
      {d.status === "installed" && !compact && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/[0.06] bg-black/30 px-3 py-2 font-mono text-xs text-zinc-300">
          <IconTerminal className="text-emerald-400" />
          ollama run {name}
        </div>
      )}
    </>
  );

  if (compact) return <div className="rounded-xl border border-white/[0.06] bg-black/20 p-4">{body}</div>;

  return (
    <Card className="p-5">
      <div className="mb-5 flex items-center gap-3">
        <ModelAvatar name={d.model} size="sm" />
        <div className="min-w-0 flex-1">
          <Link to={`/m/${d.model}`} className="block truncate font-semibold tracking-tight hover:text-emerald-400">
            {name}
          </Link>
          <div className="text-xs text-zinc-500">Added {new Date(d.createdAt).toLocaleString()}</div>
        </div>
        <StatusBadge label={label} />
      </div>
      {body}
    </Card>
  );
}
