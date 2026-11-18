import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { displayName, type Dashboard, type InstalledModel } from "../lib/api";
import { formatBytes } from "../lib/format";
import { useDashboard, useLiveStats } from "../lib/hooks";
import { fitStyles, memoryFit, paramBillions } from "../lib/insights";
import { Card, EmptyState, ModelAvatar, SizeChip } from "../components/ui";
import DeleteModelButton from "../components/DeleteModelButton";
import { IconAlert, IconBox, IconCpu, IconDisk, IconMemory } from "../components/icons";

function Tile({ icon, label, value, sub, accent, warn }: { icon: ReactNode; label: string; value: string; sub?: ReactNode; accent: string; warn?: boolean }) {
  return (
    <Card className={`p-5 ${warn ? "border-amber-500/30" : ""}`}>
      <div className="flex items-center gap-3">
        <div className={`grid size-10 place-items-center rounded-xl text-lg ring-1 ring-inset ${accent}`}>{icon}</div>
        <div className="text-xs text-zinc-500">{label}</div>
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-tight">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-zinc-500">{sub}</div>}
    </Card>
  );
}

function DiskCard({ d }: { d: Dashboard }) {
  const total = d.system.diskTotal;
  const free = d.system.diskFree;
  const used = Math.max(0, total - free);
  const models = Math.min(d.storage.models, used);
  const staging = Math.min(d.storage.staging, used - models);
  const other = Math.max(0, used - models - staging);
  const segs = [
    { key: "Ollama models", value: models, cls: "bg-[#059669]" },
    { key: "Partial downloads", value: staging, cls: "bg-[#6366f1]" },
    { key: "Other files", value: other, cls: "bg-zinc-600" },
  ].filter((s) => s.value > 0);
  const freePct = total ? (free / total) * 100 : 0;
  const largest = Math.max(0, ...d.models.map((m) => m.size));

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold tracking-tight">Disk</h2>
        <span className="truncate font-mono text-xs text-zinc-500" title={d.modelsDir}>{d.modelsDir}</span>
      </div>
      {total > 0 ? (
        <>
          <div className="mt-4 flex h-4 gap-0.5 overflow-hidden rounded-md bg-white/[0.06]" role="img" aria-label={`Disk: ${formatBytes(used)} used of ${formatBytes(total)}`}>
            {segs.map((s) => (
              <div key={s.key} className={`h-full transition-[width] duration-700 first:rounded-l-md ${s.cls}`} style={{ width: `${(s.value / total) * 100}%` }} title={`${s.key}: ${formatBytes(s.value)}`} />
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
            {segs.map((s) => (
              <div key={s.key}>
                <div className="flex items-center gap-2 text-xs text-zinc-500"><span className={`size-2.5 rounded-sm ${s.cls}`} />{s.key}</div>
                <div className="mt-0.5 font-mono text-zinc-200">{formatBytes(s.value)} <span className="text-xs text-zinc-500">{((s.value / total) * 100).toFixed(0)}%</span></div>
              </div>
            ))}
            <div>
              <div className="flex items-center gap-2 text-xs text-zinc-500"><span className="size-2.5 rounded-sm bg-white/[0.06] ring-1 ring-inset ring-white/15" />Free</div>
              <div className="mt-0.5 font-mono text-zinc-200">{formatBytes(free)} <span className="text-xs text-zinc-500">{freePct.toFixed(0)}%</span></div>
            </div>
          </div>
          {(freePct < 10 || (largest > 0 && free < largest)) && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
              <IconAlert className="mt-0.5 shrink-0" />
              <span>
                Low disk space — only {formatBytes(free)} free.
                {largest > 0 && free < largest && ` That's less than your largest model (${formatBytes(largest)}).`} Delete models you don't use below.
              </span>
            </div>
          )}
        </>
      ) : (
        <p className="mt-3 text-sm text-zinc-500">Disk space is not available on this platform.</p>
      )}
    </Card>
  );
}

type Sort = "size" | "params" | "recent" | "name";

function ModelsBySize({ d }: { d: Dashboard }) {
  const [sort, setSort] = useState<Sort>("size");
  const max = Math.max(1, ...d.models.map((m) => m.size));
  const total = d.models.reduce((s, m) => s + m.size, 0) || 1;
  const sorters: Record<Sort, (a: InstalledModel, b: InstalledModel) => number> = {
    size: (a, b) => b.size - a.size,
    params: (a, b) => paramBillions(b.parameterSize) - paramBillions(a.parameterSize),
    recent: (a, b) => +new Date(b.modifiedAt) - +new Date(a.modifiedAt),
    name: (a, b) => a.name.localeCompare(b.name),
  };
  const models = [...d.models].sort(sorters[sort]);
  const loaded = new Set(d.ollama.loaded.map((l) => l.name));

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold tracking-tight">Models by size</h2>
        <div className="flex gap-1 rounded-full border border-white/[0.08] bg-white/[0.03] p-0.5 text-xs">
          {(["size", "params", "recent", "name"] as Sort[]).map((s) => (
            <button key={s} onClick={() => setSort(s)} className={`rounded-full px-3 py-1 capitalize transition ${sort === s ? "bg-white text-zinc-900" : "text-zinc-400 hover:text-white"}`}>
              {s}
            </button>
          ))}
        </div>
      </div>
      <ul className="mt-4 divide-y divide-white/[0.05]">
        {models.map((m, i) => {
          const fit = memoryFit(m.size, d.system.memoryTotal);
          const short = `${displayName(m.model)}:${m.tag}`;
          return (
            <li key={m.name} className="group flex items-center gap-3 py-3">
              <span className="w-5 shrink-0 text-right font-mono text-xs text-zinc-600">{i + 1}</span>
              <ModelAvatar name={m.model} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Link to={`/installed/${m.model}/${m.tag}`} className="truncate font-medium tracking-tight hover:text-emerald-400">{short}</Link>
                  {m.parameterSize && <SizeChip>{m.parameterSize}</SizeChip>}
                  {m.quantization && <SizeChip>{m.quantization}</SizeChip>}
                  {loaded.has(short) && <span className="text-[11px] text-sky-300">● running</span>}
                </div>
                <div className="mt-1.5 flex items-center gap-3">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.05]" title={`${formatBytes(m.size)} · ${((m.size / total) * 100).toFixed(1)}% of model storage`}>
                    <div className="h-full rounded-full bg-[#059669]" style={{ width: `${(m.size / max) * 100}%` }} />
                  </div>
                  {fit && (
                    <span className={`hidden w-32 shrink-0 items-center justify-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset sm:inline-flex ${fitStyles[fit.level]}`} title={fit.detail}>
                      {fit.level !== "good" && <IconAlert />} {fit.label}
                    </span>
                  )}
                </div>
              </div>
              <div className="w-20 shrink-0 text-right">
                <div className="font-mono text-sm text-zinc-200">{formatBytes(m.size)}</div>
                <div className="text-[11px] text-zinc-500">{((m.size / total) * 100).toFixed(0)}%</div>
              </div>
              <DeleteModelButton model={m.model} tag={m.tag} size={m.size} />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Row({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <span className="text-zinc-500">{label}</span>
      <span className="truncate text-right text-zinc-200">{value}</span>
    </div>
  );
}

function SystemCard({ d }: { d: Dashboard }) {
  const s = d.system;
  const memUsed = s.memoryTotal - s.memoryAvailable;
  return (
    <Card className="p-5 sm:p-6">
      <h2 className="font-semibold tracking-tight">This computer</h2>
      <div className="mt-3 divide-y divide-white/[0.05]">
        {s.hostname && <Row label="Name" value={s.hostname} />}
        <Row label="System" value={`${s.os} ${s.osVersion}`.trim()} />
        {s.cpu && <Row label="Chip" value={s.cpu} />}
        <Row label="Cores" value={s.cores} />
        <Row label="Architecture" value={s.arch} />
        <Row label="Memory" value={formatBytes(s.memoryTotal)} />
      </div>
      {s.memoryTotal > 0 && s.memoryAvailable > 0 && (
        <div className="mt-3">
          <div className="flex justify-between text-xs text-zinc-500">
            <span>Memory in use</span>
            <span className="font-mono tabular-nums">{formatBytes(memUsed)} / {formatBytes(s.memoryTotal)} · {Math.round((memUsed / s.memoryTotal) * 100)}%</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/[0.06]">
            <div className="h-full rounded-full bg-[#6366f1] transition-[width] duration-700" style={{ width: `${(memUsed / s.memoryTotal) * 100}%` }} />
          </div>
        </div>
      )}
      {s.source === "container" && (
        <p className="mt-3 text-xs text-amber-300/80">Showing the Docker VM, not your Mac. Re-run ./start.sh to start the host helper.</p>
      )}
    </Card>
  );
}

function OllamaCard({ d }: { d: Dashboard }) {
  const o = d.ollama;
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold tracking-tight">Ollama</h2>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${o.running ? fitStyles.good : "bg-zinc-500/10 text-zinc-400 ring-zinc-500/25"}`}>
          <span className={`size-1.5 rounded-full ${o.running ? "bg-emerald-400" : "bg-zinc-500"}`} />
          {o.running ? `Running ${o.version}` : "Not running"}
        </span>
      </div>
      {!o.running && <p className="mt-3 text-sm text-zinc-500">Start the Ollama app to see which models are loaded in memory.</p>}
      {o.running && o.loaded.length === 0 && <p className="mt-3 text-sm text-zinc-500">No model is loaded right now.</p>}
      {o.loaded.length > 0 && (
        <ul className="mt-3 space-y-3">
          {o.loaded.map((l) => {
            const gpu = l.size ? Math.round((l.size_vram / l.size) * 100) : 0;
            const mins = Math.max(0, Math.round((+new Date(l.expires_at) - Date.now()) / 60000));
            return (
              <li key={l.name} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-mono text-sm">{l.name}</span>
                  <span className="shrink-0 font-mono text-xs text-zinc-400">{formatBytes(l.size)}</span>
                </div>
                <div className="mt-1 text-xs text-zinc-500">
                  {gpu >= 100 ? "100% GPU" : gpu === 0 ? "100% CPU" : `${gpu}% GPU / ${100 - gpu}% CPU`}
                  {mins > 24 * 60 ? " · stays loaded" : mins > 0 ? ` · unloads in ${mins} min` : ""}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function FamilyCard({ d }: { d: Dashboard }) {
  const map = new Map<string, { count: number; size: number }>();
  for (const m of d.models) {
    const k = m.family || "unknown";
    const v = map.get(k) ?? { count: 0, size: 0 };
    map.set(k, { count: v.count + 1, size: v.size + m.size });
  }
  const rows = [...map.entries()].sort((a, b) => b[1].size - a[1].size);
  if (rows.length === 0) return null;
  return (
    <Card className="p-5 sm:p-6">
      <h2 className="font-semibold tracking-tight">By family</h2>
      <div className="mt-3 divide-y divide-white/[0.05]">
        {rows.map(([k, v]) => (
          <Row key={k} label={<span className="font-mono text-zinc-300">{k}</span>} value={<span className="font-mono text-xs">{v.count} · {formatBytes(v.size)}</span>} />
        ))}
      </div>
    </Card>
  );
}

export default function DashboardPage() {
  const { data: d, isLoading, error } = useDashboard();
  const live = useLiveStats();

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-zinc-400">Your models, disk space and machine at a glance.</p>
        </div>
        <span
          title={live ? "Memory, disk and Ollama update every second" : "Reconnecting to live updates…"}
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${live ? fitStyles.good : "bg-zinc-500/10 text-zinc-400 ring-zinc-500/25"}`}
        >
          <span className="relative flex size-2">
            {live && <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />}
            <span className={`relative inline-flex size-2 rounded-full ${live ? "bg-emerald-400" : "bg-zinc-500"}`} />
          </span>
          {live ? "Live" : "Offline"}
        </span>
      </div>

      {isLoading && <div className="h-40 animate-pulse rounded-2xl bg-white/5" />}
      {error && <EmptyState icon="!" title="Could not load the dashboard">{(error as Error).message}</EmptyState>}

      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile
              icon={<IconBox />}
              label="Installed models"
              value={String(d.models.length)}
              sub={d.ollama.loaded.length > 0 ? `${d.ollama.loaded.length} loaded in memory` : "none loaded"}
              accent="bg-emerald-500/10 text-emerald-300 ring-emerald-500/20"
            />
            <Tile
              icon={<IconDisk />}
              label="Model storage"
              value={formatBytes(d.storage.models)}
              sub={d.system.diskTotal ? `${((d.storage.models / d.system.diskTotal) * 100).toFixed(1)}% of disk` : undefined}
              accent="bg-teal-500/10 text-teal-300 ring-teal-500/20"
            />
            <Tile
              icon={<IconDisk />}
              label="Free space"
              value={formatBytes(d.system.diskFree)}
              sub={d.system.diskTotal ? `of ${formatBytes(d.system.diskTotal)}` : undefined}
              accent="bg-sky-500/10 text-sky-300 ring-sky-500/20"
              warn={d.system.diskTotal > 0 && d.system.diskFree / d.system.diskTotal < 0.1}
            />
            <Tile
              icon={d.system.cpu ? <IconCpu /> : <IconMemory />}
              label="Memory"
              value={formatBytes(d.system.memoryTotal)}
              sub={d.system.memoryAvailable ? `${formatBytes(d.system.memoryTotal - d.system.memoryAvailable)} in use` : d.system.cpu || `${d.system.cores} cores`}
              accent="bg-indigo-500/10 text-indigo-300 ring-indigo-500/20"
            />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <DiskCard d={d} />
              {d.models.length === 0 ? (
                <EmptyState icon={<IconBox />} title="No models installed yet">
                  <Link to="/" className="text-emerald-400 hover:underline">Browse the library</Link> to download one.
                </EmptyState>
              ) : (
                <ModelsBySize d={d} />
              )}
            </div>
            <div className="space-y-6">
              <SystemCard d={d} />
              <OllamaCard d={d} />
              <FamilyCard d={d} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
