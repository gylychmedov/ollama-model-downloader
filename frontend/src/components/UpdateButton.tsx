import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { formatBytes } from "../lib/format";
import { useDownloads, useUpdateModel, useUpdates } from "../lib/hooks";
import { IconRefresh } from "./icons";

function useModelUpdate(model: string, tag: string) {
  const qc = useQueryClient();
  const { data: updates } = useUpdates();
  const { data: downloads } = useDownloads();
  const update = updates?.find((u) => u.model === model && u.tag === tag);
  const download = downloads?.find((d) => d.model === model && d.tag === tag && d.status !== "installed");

  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !download) {
      for (const key of ["updates", "installed-models", "installed-detail", "dashboard"]) qc.invalidateQueries({ queryKey: [key] });
    }
    wasRunning.current = !!download;
  }, [download, qc]);

  return { update, download };
}

export function UpdateBadge({ model, tag }: { model: string; tag: string }) {
  const { update, download } = useModelUpdate(model, tag);
  if (!update?.available && !download) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300 ring-1 ring-inset ring-amber-500/25">
      <IconRefresh /> {download ? "Updating" : "Update available"}
    </span>
  );
}

export default function UpdateButton({ model, tag }: { model: string; tag: string }) {
  const { update, download } = useModelUpdate(model, tag);
  const run = useUpdateModel();
  const btn = "inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition disabled:opacity-50";

  if (download) {
    const total = download.totalBytes || 1;
    const done = Math.max(download.downloadedBytes, download.live?.downloadedBytes ?? 0);
    const label = download.status === "installing" ? "Installing…" : download.status === "error" ? "Update failed" : download.status === "paused" ? "Update paused" : `Updating ${Math.round((done / total) * 100)}%`;
    return (
      <Link to="/downloads" title="See progress on Downloads" className={`${btn} border border-amber-500/25 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20`}>
        <IconRefresh className={download.status === "downloading" || download.status === "installing" ? "animate-spin" : ""} /> {label}
      </Link>
    );
  }
  if (!update?.available) return null;

  const busy = run.isPending && run.variables?.model === model && run.variables?.tag === tag;
  return (
    <button
      disabled={busy}
      title="Download only the files that changed in the registry"
      onClick={() => run.mutate({ model, tag })}
      className={`${btn} bg-emerald-500 text-[#fff] shadow-lg shadow-emerald-500/20 hover:bg-emerald-400`}
    >
      <IconRefresh /> {busy ? "Starting…" : update.downloadBytes > 0 ? `Update · ${formatBytes(update.downloadBytes)}` : "Update"}
    </button>
  );
}
