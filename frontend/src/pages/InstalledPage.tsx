import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { chatHref, displayName, exportName, type InstalledModel, type TransferPackage } from "../lib/api";
import { formatBytes } from "../lib/format";
import { useCheckUpdates, useDashboard, useInstalledModels, useTransferActions, useTransfers, useUpdates } from "../lib/hooks";
import { fitStyles, memoryFit, paramBillions } from "../lib/insights";
import ProgressBar from "../components/ProgressBar";
import DeleteModelButton from "../components/DeleteModelButton";
import UpdateButton, { UpdateBadge } from "../components/UpdateButton";
import { Card, EmptyState, ModelAvatar, SizeChip } from "../components/ui";
import {
  IconAlert,
  IconArrowRight,
  IconBolt,
  IconBroom,
  IconBox,
  IconCheck,
  IconChevronDown,
  IconChat,
  IconCopy,
  IconDisk,
  IconFolder,
  IconMemory,
  IconRefresh,
  IconSearch,
  IconTerminal,
  IconTrash,
  IconUsb,
} from "../components/icons";

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent);
const finder = isMac ? "Finder" : "the file manager";
const btn = "inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition disabled:opacity-50";
const ghost = `${btn} border border-white/10 bg-white/5 hover:bg-white/10`;

type Sort = "size" | "params" | "recent" | "name";

const sorters: Record<Sort, (a: InstalledModel, b: InstalledModel) => number> = {
  size: (a, b) => b.size - a.size,
  params: (a, b) => paramBillions(b.parameterSize) - paramBillions(a.parameterSize),
  recent: (a, b) => +new Date(b.modifiedAt) - +new Date(a.modifiedAt),
  name: (a, b) => a.name.localeCompare(b.name),
};

function ago(iso: string) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  return min < 1 ? "just now" : min < 60 ? `${min} min ago` : min < 48 * 60 ? `${Math.round(min / 60)} h ago` : `${Math.round(min / 1440)} days ago`;
}

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

function CheckUpdates() {
  const { data, isFetching } = useUpdates();
  const check = useCheckUpdates();
  const busy = check.isPending || (isFetching && !data);
  const checked = data?.map((u) => u.checkedAt).filter((t) => t && !t.startsWith("0001")).sort()[0];
  return (
    <div className="flex flex-col items-start gap-1.5 sm:items-end">
      <button disabled={busy} onClick={() => check.mutate()} className={ghost}>
        <IconRefresh className={busy ? "animate-spin" : ""} /> {busy ? "Checking…" : "Check for updates"}
      </button>
      {!busy && checked && <span className="text-xs text-zinc-500">Checked {ago(checked)}</span>}
    </div>
  );
}

function CommandLine({ name }: { name: string }) {
  const [copied, setCopied] = useState(false);
  const cmd = `ollama run ${name}`;
  return (
    <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-black/30 py-1.5 pr-1.5 pl-3 font-mono text-xs text-zinc-300">
      <IconTerminal className="shrink-0 text-emerald-400" />
      <span className="min-w-0 flex-1 truncate">{cmd}</span>
      <button
        title="Copy command"
        onClick={() => navigator.clipboard?.writeText(cmd).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
        className="grid size-7 shrink-0 place-items-center rounded-lg text-zinc-500 transition hover:bg-white/10 hover:text-white"
      >
        {copied ? <IconCheck className="text-emerald-400" /> : <IconCopy />}
      </button>
    </div>
  );
}

function ModelCard({ m, pkg, share, memoryTotal, loaded }: { m: InstalledModel; pkg?: TransferPackage; share: number; memoryTotal: number; loaded: boolean }) {
  const a = useTransferActions();
  const name = `${displayName(m.model)}:${m.tag}`;
  const preparing = pkg?.status === "exporting" || (a.exportModel.isPending && a.exportModel.variables?.model === m.model && a.exportModel.variables?.tag === m.tag);
  const ready = pkg && !preparing && pkg.status !== "error";
  const fit = memoryFit(m.size, memoryTotal);
  const href = `/installed/${m.model}/${m.tag}`;

  return (
    <Card className="group relative flex flex-col overflow-hidden p-5 sm:p-6">
      <div className="pointer-events-none absolute -top-20 -right-20 size-56 rounded-full bg-emerald-500/[0.07] blur-3xl transition group-hover:bg-emerald-500/[0.12]" />

      <div className="relative flex items-start gap-4">
        <Link to={href}><ModelAvatar name={m.model} /></Link>
        <div className="min-w-0 flex-1">
          <Link to={href} className="block truncate text-lg font-semibold tracking-tight transition hover:text-emerald-400">{name}</Link>
          <div className="mt-0.5 truncate text-xs text-zinc-500">
            {m.family && <span className="capitalize">{m.family} · </span>}
            Installed {new Date(m.modifiedAt).toLocaleDateString()}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-xl font-semibold tracking-tight">{formatBytes(m.size)}</div>
          <div className="text-[11px] text-zinc-500">{(share * 100).toFixed(0)}% of storage</div>
        </div>
      </div>

      <div className="relative mt-4 flex flex-wrap gap-1.5">
        <UpdateBadge model={m.model} tag={m.tag} />
        {m.parameterSize && <SizeChip>{m.parameterSize}</SizeChip>}
        {m.quantization && <SizeChip>{m.quantization}</SizeChip>}
        {fit && (
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${fitStyles[fit.level]}`} title={fit.detail}>
            {fit.level === "good" ? <IconBolt /> : <IconAlert />} {fit.label}
          </span>
        )}
        {loaded && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-300 ring-1 ring-inset ring-sky-500/25">
            <span className="size-1.5 rounded-full bg-sky-400" /> Loaded in memory
          </span>
        )}
      </div>

      <div className="relative mt-4 h-1.5 overflow-hidden rounded-full bg-white/[0.05]" title={`${formatBytes(m.size)} · ${(share * 100).toFixed(1)}% of model storage`}>
        <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400" style={{ width: `${Math.max(2, share * 100)}%` }} />
      </div>

      <div className="relative mt-4"><CommandLine name={name} /></div>

      {preparing && pkg && (
        <div className="relative mt-4">
          <ProgressBar value={pkg.progressTotal ? pkg.progressBytes / pkg.progressTotal : 0} active />
          <div className="mt-1.5 text-xs text-zinc-500">Preparing folder… it opens in {finder} when ready.</div>
        </div>
      )}
      {ready && (
        <div className="relative mt-4 flex items-center gap-2 rounded-xl border border-indigo-500/20 bg-indigo-500/5 py-1.5 pr-1.5 pl-3 text-xs text-indigo-200">
          <IconUsb className="shrink-0" />
          <span className="min-w-0 flex-1 truncate font-mono" title={pkg.path}>{pkg.path}</span>
          <button title={isMac ? "Show in Finder" : "Show in folder"} disabled={a.reveal.isPending} onClick={() => a.reveal.mutate(pkg.name)} className="grid size-7 shrink-0 place-items-center rounded-lg transition hover:bg-indigo-500/15">
            <IconFolder />
          </button>
          <button
            title="Remove the prepared folder"
            onClick={() => confirm(`Delete the prepared folder ${pkg.path}? The installed model stays in Ollama.`) && a.remove.mutate(pkg.name)}
            className="grid size-7 shrink-0 place-items-center rounded-lg text-indigo-300/70 transition hover:bg-red-500/10 hover:text-red-300"
          >
            <IconTrash />
          </button>
        </div>
      )}
      {pkg?.status === "error" && (
        <div className="relative mt-4 flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          <IconAlert className="mt-0.5 shrink-0" />
          <span>{pkg.error}</span>
        </div>
      )}

      <div className="h-5 shrink-0" />
      <div className="relative mt-auto flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-4">
        <UpdateButton model={m.model} tag={m.tag} />
        <Link to={chatHref(m.model, m.tag)} className={ghost}><IconChat /> Try</Link>
        <Link to={href} className={ghost}>Details <IconArrowRight /></Link>
        <button
          disabled={preparing}
          title={ready ? "Prepare the folder again" : "Prepare a folder you can copy to another computer"}
          onClick={() => a.exportModel.mutate({ model: m.model, tag: m.tag })}
          className={ghost}
        >
          <IconUsb /> {preparing ? "Preparing…" : ready ? "Re-copy" : "Copy to USB"}
        </button>
        <div className="ml-auto"><DeleteModelButton model={m.model} tag={m.tag} size={m.size} /></div>
      </div>
    </Card>
  );
}

function TransferHelp({ dir }: { dir?: string }) {
  const [open, setOpen] = useState(false);
  const steps = [
    <>Click <b className="text-zinc-200">Copy to USB</b> on a model. Its files are gathered into one folder, which opens in {finder}.</>,
    <>Copy that folder to a USB drive (or a network share).</>,
    <>
      On the other computer, paste it into <code className="rounded bg-black/30 px-1 font-mono text-[11px] text-zinc-300">{dir ?? "…/transfer"}</code> or pick it with{" "}
      <b className="text-zinc-200">Choose folder…</b> on <Link to="/downloads" className="text-emerald-400 hover:underline">Downloads</Link>, then click Install. Without this app, follow README.txt inside the folder.
    </>,
  ];
  return (
    <Card className="mt-10 overflow-hidden">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-white/[0.03]">
        <span className="grid size-9 place-items-center rounded-xl bg-indigo-500/10 text-indigo-300 ring-1 ring-inset ring-indigo-500/25"><IconUsb /></span>
        <span className="flex-1">
          <span className="block text-sm font-semibold tracking-tight">Move a model to another computer</span>
          <span className="block text-xs text-zinc-500">No internet needed on the other side — copy the files over USB.</span>
        </span>
        <IconChevronDown className={`text-zinc-500 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ol className="grid gap-4 border-t border-white/[0.06] px-5 py-5 text-sm text-zinc-400 md:grid-cols-3">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-indigo-500/15 text-xs font-semibold text-indigo-300 ring-1 ring-inset ring-indigo-500/30">{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

export default function InstalledPage() {
  const { data, isLoading, error } = useInstalledModels();
  const { data: dash } = useDashboard();
  const { data: transfers } = useTransfers();
  const { data: updates } = useUpdates();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("size");

  const byName = new Map(transfers?.packages.map((p) => [p.name, p]));
  const total = data?.reduce((s, m) => s + m.size, 0) ?? 0;
  const loaded = new Set(dash?.ollama.loaded.map((l) => l.name));
  const updateCount = updates?.filter((u) => u.available).length ?? 0;
  const largest = data?.reduce<InstalledModel | undefined>((best, m) => (!best || m.size > best.size ? m : best), undefined);
  const q = query.trim().toLowerCase();
  const models = [...(data ?? [])].filter((m) => !q || m.name.toLowerCase().includes(q) || m.family.toLowerCase().includes(q)).sort(sorters[sort]);
  const isLoaded = (m: InstalledModel) => loaded.has(`${displayName(m.model)}:${m.tag}`) || loaded.has(m.name);

  return (
    <div>
      <Card className="relative overflow-hidden p-6 sm:p-8">
        <div className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 size-72 rounded-full bg-indigo-500/[0.07] blur-3xl" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-start">
          <div className="grid size-16 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-600 text-2xl text-[#fff] shadow-lg shadow-black/30 ring-1 ring-white/20">
            <IconBox />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs text-zinc-500">Ollama library on this computer</div>
            <h1 className="mt-0.5 text-3xl font-semibold tracking-tight">Installed models</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
              Everything ready for <code className="font-mono text-zinc-300">ollama run</code>. Keep models current, move them to another machine, or free up space.
            </p>
          </div>
          <div className="flex flex-wrap items-start gap-2 sm:justify-end">
            <Link to="/cleanup" className={ghost}><IconBroom /> Free up space</Link>
            {!!data?.length && <CheckUpdates />}
          </div>
        </div>

        <div className="relative mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat icon={<IconBox />} label="Models" value={data?.length ?? "—"} sub={largest ? `Largest: ${displayName(largest.model)}:${largest.tag}` : undefined} accent="bg-emerald-500/10 text-emerald-300 ring-emerald-500/25" />
          <Stat icon={<IconDisk />} label="On disk" value={formatBytes(dash?.storage.models ?? total)} sub={dash?.system.diskFree ? `${formatBytes(dash.system.diskFree)} free` : undefined} accent="bg-teal-500/10 text-teal-300 ring-teal-500/25" />
          <Stat icon={<IconMemory />} label="Loaded now" value={dash ? dash.ollama.loaded.length : "—"} sub={dash ? (dash.ollama.running ? "Ollama is running" : "Ollama is not running") : undefined} accent="bg-sky-500/10 text-sky-300 ring-sky-500/25" />
          <Stat
            icon={<IconRefresh />}
            label="Updates"
            value={updates ? updateCount : "—"}
            sub={updates ? (updateCount ? "New versions in the registry" : "Everything is up to date") : "Checking…"}
            accent={updateCount ? "bg-amber-500/10 text-amber-300 ring-amber-500/25" : "bg-zinc-500/10 text-zinc-300 ring-zinc-500/25"}
          />
        </div>
      </Card>

      {!!data?.length && (
        <div className="mt-8 mb-4 flex flex-wrap items-center gap-3">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm focus-within:border-emerald-500/40 sm:max-w-xs">
            <IconSearch className="shrink-0 text-zinc-500" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter models…" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-zinc-600" />
          </label>
          <div className="ml-auto flex gap-1 rounded-full border border-white/[0.08] bg-white/[0.03] p-0.5 text-xs">
            {(["size", "params", "recent", "name"] as Sort[]).map((s) => (
              <button key={s} onClick={() => setSort(s)} className={`rounded-full px-3 py-1 capitalize transition ${sort === s ? "bg-white text-zinc-900" : "text-zinc-400 hover:text-white"}`}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {isLoading && (
        <div className="mt-8 grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-72 animate-pulse rounded-2xl bg-white/5" />)}
        </div>
      )}
      {error && <div className="mt-8"><EmptyState icon="!" title="Could not load installed models">{(error as Error).message}</EmptyState></div>}
      {data?.length === 0 && (
        <div className="mt-8">
          <EmptyState icon={<IconBox />} title="No models installed yet">
            <Link to="/" className="text-emerald-400 hover:underline">Browse the library</Link> or install one copied from another computer on{" "}
            <Link to="/downloads" className="text-emerald-400 hover:underline">Downloads</Link>.
          </EmptyState>
        </div>
      )}
      {!!data?.length && models.length === 0 && <p className="py-10 text-center text-sm text-zinc-500">No models match “{query}”.</p>}

      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {models.map((m) => (
          <ModelCard key={m.name} m={m} pkg={byName.get(exportName(m.model, m.tag))} share={total ? m.size / total : 0} memoryTotal={dash?.system.memoryTotal ?? 0} loaded={isLoaded(m)} />
        ))}
      </div>

      {!!data?.length && <TransferHelp dir={transfers?.dir} />}
    </div>
  );
}
