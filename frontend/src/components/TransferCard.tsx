import { displayName, type TransferPackage } from "../lib/api";
import { formatBytes } from "../lib/format";
import { useTransferActions } from "../lib/hooks";
import ProgressBar from "./ProgressBar";
import { Card, ModelAvatar } from "./ui";
import { IconAlert, IconBox, IconFolder, IconTrash, IconUsb } from "./icons";

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent);

const statusInfo: Record<TransferPackage["status"], { label: string; cls: string; dot: string }> = {
  copying: { label: "copying…", cls: "bg-amber-500/10 text-amber-300 ring-amber-500/20", dot: "bg-amber-400 animate-pulse" },
  ready: { label: "ready to install", cls: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/20", dot: "bg-emerald-400" },
  verifying: { label: "verifying", cls: "bg-violet-500/10 text-violet-300 ring-violet-500/20", dot: "bg-violet-400 animate-pulse" },
  installing: { label: "installing", cls: "bg-violet-500/10 text-violet-300 ring-violet-500/20", dot: "bg-violet-400 animate-pulse" },
  installed: { label: "already installed", cls: "bg-white/5 text-zinc-300 ring-white/10", dot: "bg-zinc-400" },
  exporting: { label: "preparing", cls: "bg-sky-500/10 text-sky-300 ring-sky-500/20", dot: "bg-sky-400 animate-pulse" },
  error: { label: "error", cls: "bg-red-500/10 text-red-300 ring-red-500/20", dot: "bg-red-400" },
  invalid: { label: "not a model", cls: "bg-red-500/10 text-red-300 ring-red-500/20", dot: "bg-red-400" },
};

/** A model folder found in the transfer folder (copied from another computer). */
export default function TransferCard({ p }: { p: TransferPackage }) {
  const a = useTransferActions();
  const s = statusInfo[p.status];
  const busy = p.status === "verifying" || p.status === "installing" || p.status === "exporting";
  const complete = p.totalBytes > 0 && p.presentBytes >= p.totalBytes;
  const canInstall = p.status === "ready" || (p.status === "error" && complete);
  const progress = busy ? (p.progressTotal ? p.progressBytes / p.progressTotal : 1) : p.totalBytes ? p.presentBytes / p.totalBytes : 0;
  const title = p.models.length ? p.models.map((m) => displayName(m.name)).join(", ") : p.name;
  const btn = "inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition disabled:opacity-50";

  return (
    <Card className="p-5">
      <div className="mb-5 flex items-center gap-3">
        <ModelAvatar name={p.models[0]?.name.split(":")[0] ?? p.name} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 truncate font-semibold tracking-tight">
            <IconUsb className="shrink-0 text-zinc-500" /> <span className="truncate">{title}</span>
          </div>
          <div className="truncate font-mono text-[11px] text-zinc-500" title={p.path}>{p.path}</div>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${s.cls}`}>
          <span className={`size-1.5 rounded-full ${s.dot}`} />
          {s.label}
        </span>
      </div>

      {p.status !== "invalid" && (
        <>
          <ProgressBar value={progress} active={busy || p.status === "copying"} tone={p.status === "error" ? "red" : p.status === "copying" ? "amber" : p.status === "installed" ? "zinc" : "emerald"} />
          <div className="mt-2 text-xs text-zinc-500">
            {p.status === "copying" && `${formatBytes(p.presentBytes)} of ${formatBytes(p.totalBytes)} copied — waiting for the rest of the files`}
            {p.status === "verifying" && `Checking files for damage… ${formatBytes(p.progressBytes)} / ${formatBytes(p.progressTotal)}`}
            {p.status === "installing" && "Moving into Ollama…"}
            {p.status === "ready" && `${formatBytes(p.totalBytes)} — all files present`}
            {p.status === "installed" && `${formatBytes(p.totalBytes)} — this computer already has this model`}
            {p.status === "error" && formatBytes(p.totalBytes)}
          </div>
        </>
      )}

      {p.error && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          <IconAlert className="mt-0.5 shrink-0" />
          <span>{p.error}</span>
        </div>
      )}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {canInstall && (
          <button
            disabled={a.install.isPending}
            onClick={() => a.install.mutate(p.name)}
            className={`${btn} bg-gradient-to-r from-emerald-400 to-teal-500 text-zinc-950 shadow-lg shadow-emerald-500/25 hover:brightness-110`}
          >
            <IconBox /> {p.status === "error" ? "Retry install" : "Install to Ollama"}
          </button>
        )}
        <button disabled={a.reveal.isPending} onClick={() => a.reveal.mutate(p.name)} className={`${btn} border border-white/10 bg-white/5 hover:bg-white/10`}>
          <IconFolder /> {isMac ? "Show in Finder" : "Show in folder"}
        </button>
        {!busy && (
          <button
            disabled={a.remove.isPending}
            title="Delete this folder"
            onClick={() => confirm(`Delete the folder ${p.path}?${p.status === "installed" ? " The installed model stays in Ollama." : ""}`) && a.remove.mutate(p.name)}
            className={`${btn} px-2.5 text-zinc-500 hover:bg-red-500/10 hover:text-red-300`}
          >
            <IconTrash />
          </button>
        )}
      </div>
    </Card>
  );
}
