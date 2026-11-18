import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { displayName, type CleanupCategory, type CleanupItem, type CleanupResult } from "../lib/api";
import { formatBytes } from "../lib/format";
import { useCleanup, useDashboard, useRunCleanup } from "../lib/hooks";
import { Card, EmptyState, ModelAvatar } from "../components/ui";
import { IconAlert, IconBox, IconBroom, IconCheck, IconClock, IconDisk, IconDownload, IconLayers, IconRefresh } from "../components/icons";

const btn = "inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition disabled:opacity-50";
const ghost = `${btn} border border-white/10 bg-white/5 hover:bg-white/10`;
const DAYS = [14, 30, 60, 90];
const DEFAULT_SELECTED: CleanupCategory[] = ["staging", "orphan"];

const sections: { key: CleanupCategory; title: string; hint: string; icon: ReactNode; accent: string }[] = [
  {
    key: "staging",
    title: "Unfinished downloads",
    hint: "Staging folders and temp files left behind by downloads that were cancelled, failed or abandoned.",
    icon: <IconDownload />,
    accent: "bg-indigo-500/10 text-indigo-300 ring-indigo-500/25",
  },
  {
    key: "orphan",
    title: "Orphaned files",
    hint: "Blobs in Ollama's store that no installed model uses any more.",
    icon: <IconLayers />,
    accent: "bg-amber-500/10 text-amber-300 ring-amber-500/25",
  },
  {
    key: "unused",
    title: "Unused models",
    hint: "Installed models nobody has run for a while. Sizes count only files no other model shares.",
    icon: <IconBox />,
    accent: "bg-rose-500/10 text-rose-300 ring-rose-500/25",
  },
];

function ago(iso?: string) {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days < 1 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}

function shortName(it: CleanupItem) {
  if (it.kind === "blob") return `${it.name.slice(0, 19)}…`;
  if (it.kind === "model" || it.kind === "download" || (it.kind === "staging" && it.name.includes(":"))) {
    const [model, tag] = [it.name.slice(0, it.name.lastIndexOf(":")), it.name.slice(it.name.lastIndexOf(":") + 1)];
    return `${displayName(model)}:${tag}`;
  }
  return it.name;
}

function Checkbox({ checked, indeterminate, onChange, label }: { checked: boolean; indeterminate?: boolean; onChange: () => void; label: string }) {
  return (
    <button
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={label}
      onClick={onChange}
      className={`grid size-5 shrink-0 place-items-center rounded-md text-xs ring-1 ring-inset transition ${
        checked || indeterminate ? "bg-emerald-500 text-zinc-950 ring-emerald-500" : "bg-white/[0.03] text-transparent ring-white/20 hover:ring-white/40"
      }`}
    >
      {indeterminate ? <span className="h-0.5 w-2.5 rounded bg-zinc-950" /> : <IconCheck />}
    </button>
  );
}

function ItemRow({ it, checked, toggle }: { it: CleanupItem; checked: boolean; toggle: () => void }) {
  const isModel = it.kind === "model";
  const model = it.name.slice(0, it.name.lastIndexOf(":"));
  const tag = it.name.slice(it.name.lastIndexOf(":") + 1);
  return (
    <li className={`flex items-center gap-3 px-5 py-3 transition ${checked ? "bg-emerald-500/[0.03]" : ""}`}>
      <Checkbox checked={checked} onChange={toggle} label={`Select ${shortName(it)}`} />
      {isModel ? <ModelAvatar name={model} size="sm" /> : null}
      <div className="min-w-0 flex-1">
        {isModel ? (
          <Link to={`/installed/${model}/${tag}`} className="block truncate font-medium tracking-tight hover:text-emerald-400">{shortName(it)}</Link>
        ) : (
          <div className={`truncate ${it.kind === "blob" || it.kind === "temp" ? "font-mono text-sm" : "font-medium tracking-tight"}`} title={it.name}>{shortName(it)}</div>
        )}
        <div className="truncate text-xs text-zinc-500">
          {it.detail}
          {isModel ? ` · last used ${ago(it.lastUsed)}` : ` · ${ago(it.modifiedAt)}`}
        </div>
      </div>
      <span className="shrink-0 font-mono text-sm text-zinc-200">{formatBytes(it.bytes)}</span>
    </li>
  );
}

function Section({ s, items, selected, setSelected, extra }: {
  s: (typeof sections)[number];
  items: CleanupItem[];
  selected: Set<string>;
  setSelected: (fn: (prev: Set<string>) => Set<string>) => void;
  extra?: ReactNode;
}) {
  const total = items.reduce((n, it) => n + it.bytes, 0);
  const picked = items.filter((it) => selected.has(it.id));
  const all = items.length > 0 && picked.length === items.length;
  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const it of items) all ? next.delete(it.id) : next.add(it.id);
      return next;
    });
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4">
        {items.length > 0 && <Checkbox checked={all} indeterminate={!all && picked.length > 0} onChange={toggleAll} label={`Select all ${s.title.toLowerCase()}`} />}
        <span className={`grid size-9 shrink-0 place-items-center rounded-xl ring-1 ring-inset ${s.accent}`}>{s.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h2 className="font-semibold tracking-tight">{s.title}</h2>
            <span className="rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] text-zinc-400">{items.length}</span>
          </div>
          <p className="text-xs text-zinc-500">{s.hint}</p>
        </div>
        {extra}
        <span className="shrink-0 font-mono text-sm font-semibold text-zinc-200">{formatBytes(total)}</span>
      </div>
      {items.length > 0 ? (
        <div className="border-t border-white/[0.06]">
          <ul className="divide-y divide-white/[0.05]">
            {items.map((it) => <ItemRow key={it.id} it={it} checked={selected.has(it.id)} toggle={() => toggle(it.id)} />)}
          </ul>
        </div>
      ) : (
        <div className="flex items-center gap-2 border-t border-white/[0.06] px-5 py-3 text-sm text-zinc-500">
          <IconCheck className="text-emerald-400" /> Nothing to clean up here.
        </div>
      )}
    </Card>
  );
}

export default function CleanupPage() {
  const [days, setDays] = useState(30);
  const { data, isLoading, isFetching, error, refetch } = useCleanup(days);
  const { data: dash } = useDashboard();
  const run = useRunCleanup();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<CleanupResult | null>(null);

  const seen = useRef(new Set<string>());

  useEffect(() => {
    if (!data) return;
    const ids = new Set(data.items.map((it) => it.id));
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => ids.has(id)));
      for (const it of data.items) {
        if (DEFAULT_SELECTED.includes(it.category) && !seen.current.has(it.id)) next.add(it.id);
        seen.current.add(it.id);
      }
      return next;
    });
  }, [data]);

  const items = useMemo(() => data?.items ?? [], [data]);
  const byCat = (c: CleanupCategory) => items.filter((it) => it.category === c);
  const picked = items.filter((it) => selected.has(it.id));
  const pickedBytes = picked.reduce((n, it) => n + it.bytes, 0);
  const totalBytes = items.reduce((n, it) => n + it.bytes, 0);
  const pickedModels = picked.filter((it) => it.kind === "model");
  const trackedDays = data ? Math.floor((Date.now() - new Date(data.trackingSince).getTime()) / 86_400_000) : 0;

  const clean = () => {
    const lines = [`Delete ${picked.length} item${picked.length === 1 ? "" : "s"} and free about ${formatBytes(pickedBytes)}?`];
    if (pickedModels.length) lines.push("", `This removes ${pickedModels.length} model${pickedModels.length === 1 ? "" : "s"} from Ollama: ${pickedModels.map(shortName).join(", ")}. You can download them again later.`);
    if (!confirm(lines.join("\n"))) return;
    setResult(null);
    run.mutate({ ids: picked.map((it) => it.id), days }, { onSuccess: setResult });
  };

  return (
    <div>
      <Card className="relative overflow-hidden p-6 sm:p-8">
        <div className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-amber-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 size-72 rounded-full bg-emerald-500/[0.07] blur-3xl" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-start">
          <div className="grid size-16 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-amber-300 to-orange-600 text-2xl text-[#fff] shadow-lg shadow-black/30 ring-1 ring-white/20">
            <IconBroom />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs text-zinc-500">Reclaim disk space</div>
            <h1 className="mt-0.5 text-3xl font-semibold tracking-tight">Disk cleanup</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
              Finds leftovers from unfinished downloads, files no model uses, and models you haven't run in a while. Pick what to remove and clean it up in one click.
            </p>
          </div>
          <button disabled={isFetching} onClick={() => { setResult(null); refetch(); }} className={`${ghost} self-start`}>
            <IconRefresh className={isFetching ? "animate-spin" : ""} /> {isFetching ? "Scanning…" : "Scan again"}
          </button>
        </div>

        <div className="relative mt-6 flex flex-col gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 sm:flex-row sm:items-center">
          <div className="grid flex-1 grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-zinc-500">Can be freed</div>
              <div className="mt-1 font-mono text-xl font-semibold text-white">{data ? formatBytes(totalBytes) : "—"}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-zinc-500">Selected</div>
              <div className="mt-1 font-mono text-xl font-semibold text-emerald-300">{formatBytes(pickedBytes)}</div>
              <div className="text-xs text-zinc-500">{picked.length} item{picked.length === 1 ? "" : "s"}</div>
            </div>
            {dash?.system.diskTotal ? (
              <div className="col-span-2 sm:col-span-1">
                <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-zinc-500"><IconDisk /> Free after</div>
                <div className="mt-1 font-mono text-xl font-semibold text-white">{formatBytes(dash.system.diskFree + pickedBytes)}</div>
                <div className="text-xs text-zinc-500">now {formatBytes(dash.system.diskFree)}</div>
              </div>
            ) : null}
          </div>
          <button
            disabled={picked.length === 0 || run.isPending}
            onClick={clean}
            className={`${btn} justify-center bg-emerald-500 px-5 py-2.5 text-zinc-950 shadow-lg shadow-emerald-500/20 hover:bg-emerald-400`}
          >
            <IconBroom /> {run.isPending ? "Cleaning…" : picked.length ? `Clean up ${formatBytes(pickedBytes)}` : "Nothing selected"}
          </button>
        </div>

        {result && (
          <div className={`relative mt-4 flex items-start gap-2 rounded-xl border px-3 py-2 text-sm ${result.errors.length ? "border-amber-500/25 bg-amber-500/5 text-amber-200" : "border-emerald-500/25 bg-emerald-500/5 text-emerald-200"}`}>
            {result.errors.length ? <IconAlert className="mt-0.5 shrink-0" /> : <IconCheck className="mt-0.5 shrink-0" />}
            <div>
              Freed {formatBytes(result.freedBytes)} by removing {result.removed} item{result.removed === 1 ? "" : "s"}.
              {result.skipped > 0 && ` ${result.skipped} skipped because they changed since the scan.`}
              {result.errors.map((e) => <div key={e} className="text-xs">{e}</div>)}
            </div>
          </div>
        )}
      </Card>

      {isLoading && <div className="mt-8 h-48 animate-pulse rounded-2xl bg-white/5" />}
      {error && <div className="mt-8"><EmptyState icon="!" title="Could not scan the disk">{(error as Error).message}</EmptyState></div>}

      {data && (
        <div className="mt-8 space-y-4">
          {sections.map((s) => (
            <Section
              key={s.key}
              s={s}
              items={byCat(s.key)}
              selected={selected}
              setSelected={setSelected}
              extra={
                s.key === "unused" && (
                  <div className="flex items-center gap-2 text-xs text-zinc-500">
                    <IconClock /> Unused for
                    <div className="flex gap-1 rounded-full border border-white/[0.08] bg-white/[0.03] p-0.5">
                      {DAYS.map((d) => (
                        <button key={d} onClick={() => setDays(d)} className={`rounded-full px-2.5 py-0.5 transition ${days === d ? "bg-white text-zinc-900" : "text-zinc-400 hover:text-white"}`}>
                          {d}d
                        </button>
                      ))}
                    </div>
                  </div>
                )
              }
            />
          ))}
          <p className="px-1 text-xs leading-relaxed text-zinc-500">
            Unfinished downloads are listed after {data.staleDays} days without progress; downloads in progress are never touched. "Last used" comes from file access times and from
            watching Ollama while this app runs{trackedDays < days ? ` (watching for ${trackedDays} day${trackedDays === 1 ? "" : "s"} so far, so treat it as an estimate)` : ""}. Models loaded in memory are never listed.
          </p>
        </div>
      )}
    </div>
  );
}
