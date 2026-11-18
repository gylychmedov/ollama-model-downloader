import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import DownloadCard from "../components/DownloadCard";
import ImportPanel from "../components/ImportPanel";
import NotificationSettings from "../components/NotificationSettings";
import TransferCard from "../components/TransferCard";
import { useDownloadActions, useDownloads, useTransfers } from "../lib/hooks";
import { displayName, type Download } from "../lib/api";
import { formatBytes, formatDuration } from "../lib/format";
import { Card, EmptyState, ModelAvatar } from "../components/ui";
import { IconArrowRight, IconBell, IconBolt, IconBox, IconCheck, IconClock, IconDownload, IconSearch, IconTrash, IconUsb } from "../components/icons";

const heading = "mt-10 mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500";
const IN_PROGRESS: Download["status"][] = ["downloading", "paused", "error", "installing"];

function Stat({ icon, label, value, sub, accent }: { icon: ReactNode; label: string; value: ReactNode; sub?: ReactNode; accent: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-zinc-500">
        <span className={`grid size-6 place-items-center rounded-lg ring-1 ring-inset ${accent}`}>{icon}</span>
        {label}
      </div>
      <div className="mt-2 truncate font-mono text-xl font-semibold text-white">{value}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}

function Count({ n }: { n: number }) {
  return <span className="rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] text-zinc-400">{n}</span>;
}

function FinishedRow({ d }: { d: Download }) {
  const a = useDownloadActions();
  const name = `${displayName(d.model)}:${d.tag}`;
  return (
    <li className="flex items-center gap-3 px-5 py-3">
      <ModelAvatar name={d.model} size="sm" />
      <div className="min-w-0 flex-1">
        <Link to={`/installed/${d.model}/${d.tag}`} className="block truncate font-medium tracking-tight hover:text-emerald-400">{name}</Link>
        <div className="truncate text-xs text-zinc-500">Installed {new Date(d.updatedAt).toLocaleString()}</div>
      </div>
      <span className="hidden font-mono text-sm text-zinc-300 sm:inline">{formatBytes(d.totalBytes)}</span>
      <Link to={`/installed/${d.model}/${d.tag}`} title="Open model" className="grid size-8 place-items-center rounded-lg text-zinc-500 transition hover:bg-white/10 hover:text-white">
        <IconArrowRight />
      </Link>
      <button
        disabled={a.remove.isPending}
        title="Clear from list"
        onClick={() => confirm("Remove this entry from the list? The installed model stays in Ollama.") && a.remove.mutate(d.id)}
        className="grid size-8 place-items-center rounded-lg text-zinc-500 transition hover:bg-red-500/10 hover:text-red-300"
      >
        <IconTrash />
      </button>
    </li>
  );
}

export default function DownloadsPage() {
  const { data, isLoading, error } = useDownloads();
  const { data: transfers } = useTransfers();
  // Exports are managed on the Installed page; here we list folders brought from other computers.
  const imports = transfers?.packages.filter((p) => p.status !== "exporting") ?? [];
  const list = data ?? [];
  const running = list.filter((d) => IN_PROGRESS.includes(d.status));
  const ready = list.filter((d) => d.status === "completed");
  const finished = list.filter((d) => d.status === "installed").sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
  const active = list.filter((d) => d.status === "downloading");
  const speed = active.reduce((s, d) => s + (d.live?.speed ?? 0), 0);
  const left = running.reduce((s, d) => s + Math.max(0, d.totalBytes - d.downloadedBytes), 0);
  const importsReady = imports.filter((p) => p.status === "ready").length;

  return (
    <div>
      <Card className="relative overflow-hidden p-6 sm:p-8">
        <div className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-sky-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 size-72 rounded-full bg-emerald-500/[0.07] blur-3xl" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-start">
          <div className="grid size-16 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-sky-400 to-indigo-600 text-2xl text-[#fff] shadow-lg shadow-black/30 ring-1 ring-white/20">
            <IconDownload />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs text-zinc-500">Resumable · verified with sha256</div>
            <h1 className="mt-0.5 text-3xl font-semibold tracking-tight">Downloads</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
              Progress is saved continuously — pause, close the app or lose connection anytime and pick up where you left off.
            </p>
          </div>
          <Link to="/" className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-sm font-medium transition hover:bg-white/10">
            <IconSearch /> Find a model
          </Link>
        </div>

        <div className="relative mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat icon={<IconDownload />} label="Active" value={active.length} sub={running.length > active.length ? `${running.length - active.length} paused or stopped` : "downloading now"} accent="bg-sky-500/10 text-sky-300 ring-sky-500/25" />
          <Stat icon={<IconBolt />} label="Speed" value={`${formatBytes(speed)}/s`} sub={speed > 0 ? `~${formatDuration(left / speed)} left` : "idle"} accent="bg-emerald-500/10 text-emerald-300 ring-emerald-500/25" />
          <Stat icon={<IconClock />} label="Remaining" value={formatBytes(left)} sub={`across ${running.length} download${running.length === 1 ? "" : "s"}`} accent="bg-indigo-500/10 text-indigo-300 ring-indigo-500/25" />
          <Stat
            icon={<IconCheck />}
            label="Ready to install"
            value={ready.length + importsReady}
            sub={importsReady ? `${importsReady} from another computer` : finished.length ? `${finished.length} finished` : "nothing waiting"}
            accent={ready.length + importsReady ? "bg-teal-500/10 text-teal-300 ring-teal-500/25" : "bg-zinc-500/10 text-zinc-300 ring-zinc-500/25"}
          />
        </div>
      </Card>

      {isLoading && <div className="mt-10 h-48 animate-pulse rounded-2xl bg-white/5" />}
      {error && <div className="mt-10"><EmptyState icon="!" title="Could not load downloads">{(error as Error).message}</EmptyState></div>}

      {running.length > 0 && (
        <>
          <h2 className={heading}><IconDownload /> In progress <Count n={running.length} /></h2>
          <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {running.map((d) => <DownloadCard key={d.id} d={d} />)}
          </div>
        </>
      )}

      {ready.length > 0 && (
        <>
          <h2 className={heading}><IconBox /> Ready to install <Count n={ready.length} /></h2>
          <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {ready.map((d) => <DownloadCard key={d.id} d={d} />)}
          </div>
        </>
      )}

      {data && running.length === 0 && ready.length === 0 && (
        <div className="mt-10">
          <EmptyState icon={<IconDownload />} title="Nothing downloading right now">
            <Link to="/" className="text-emerald-400 hover:underline">Browse the library</Link> to start a download.
          </EmptyState>
        </div>
      )}

      <h2 className={heading}><IconUsb /> From another computer {imports.length > 0 && <Count n={imports.length} />}</h2>
      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        <ImportPanel dir={transfers?.dir} />
        {imports.map((p) => <TransferCard key={p.name} p={p} />)}
      </div>

      <h2 className={heading}><IconBell /> Notifications</h2>
      <NotificationSettings />

      {finished.length > 0 && (
        <>
          <h2 className={heading}><IconCheck /> Finished <Count n={finished.length} /></h2>
          <Card className="overflow-hidden">
            <ul className="divide-y divide-white/[0.05]">
              {finished.map((d) => <FinishedRow key={d.id} d={d} />)}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
