import type { ReactNode } from "react";
import type { SystemInfo } from "../lib/api";
import { formatBytes } from "../lib/format";
import { fitStyles, requirements, type Fit } from "../lib/insights";
import { IconAlert, IconBolt, IconCheck, IconCpu, IconDisk, IconGauge, IconMemory } from "./icons";

const barColor: Record<Fit["level"], string> = {
  good: "from-emerald-400 to-teal-400",
  warn: "from-amber-400 to-orange-400",
  bad: "from-red-400 to-rose-500",
};

const gb = (n: number) => `${Math.round(n / 1024 ** 3)} GB`;

export function FitBadge({ fit }: { fit: Fit }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${fitStyles[fit.level]}`} title={fit.detail}>
      {fit.level === "good" ? <IconBolt /> : <IconAlert />} {fit.label}
    </span>
  );
}

export function MachineSummary({ system }: { system: SystemInfo }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-500">
      <span className="inline-flex items-center gap-1.5 text-zinc-400">
        <IconCpu /> {system.cpu || system.arch} · {gb(system.memoryTotal)} RAM · {system.cores} cores · {formatBytes(system.diskFree)} free
      </span>
      {system.source === "container" && <span className="text-amber-300/80">Docker VM values — run ./start.sh for real hardware</span>}
    </div>
  );
}

function Meter({ icon, label, value, pct, level, note }: { icon: ReactNode; label: string; value: ReactNode; pct?: number; level: Fit["level"]; note: ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/5 text-xl text-zinc-300 ring-1 ring-white/10">{icon}</span>
        <span className="text-sm font-medium text-zinc-400">{label}</span>
      </div>
      <div className="mt-4 font-mono text-2xl tracking-tight">{value}</div>
      {pct !== undefined && (
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.06]">
          <div className={`h-full rounded-full bg-gradient-to-r ${barColor[level]} transition-all duration-500`} style={{ width: `${Math.max(Math.min(pct, 100), 2)}%` }} />
        </div>
      )}
      <div className="mt-2.5 text-sm text-zinc-400">{note}</div>
    </div>
  );
}

const of = (need: number, have: number) => (
  <>
    <span className="font-semibold text-white">{formatBytes(need)}</span>
    <span className="text-base text-zinc-500"> / {formatBytes(have)}</span>
  </>
);

export default function VariantRequirements({ size, system, installed }: { size: number; system: SystemInfo; installed: boolean }) {
  const r = requirements(size, system);
  const memLevel: Fit["level"] = r.memory <= system.memoryTotal * 0.75 ? "good" : r.memory <= system.memoryTotal ? "warn" : "bad";
  const diskLevel: Fit["level"] = installed ? "good" : !r.diskOk ? "bad" : r.weights > system.diskFree * 0.8 ? "warn" : "good";
  const speed = r.tokensPerSec >= 30 ? "very fast" : r.tokensPerSec >= 12 ? "smooth chat" : r.tokensPerSec >= 5 ? "usable" : "slow";

  return (
    <div className="mt-5 border-t border-white/[0.06] pt-5">
      <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
        <Meter icon={<IconMemory />} label="RAM" value={of(r.memory, system.memoryTotal)} pct={(r.memory / system.memoryTotal) * 100} level={memLevel} note="weights + context cache" />
        {r.apple ? (
          <Meter
            icon={<IconCpu />}
            label="GPU"
            value={of(r.memory, r.gpuLimit)}
            pct={(r.memory / r.gpuLimit) * 100}
            level={r.fullGpu ? "good" : "warn"}
            note={r.fullGpu ? "fully on GPU" : "spills to CPU"}
          />
        ) : (
          <Meter icon={<IconCpu />} label="VRAM" value={<span className="font-semibold text-white">≥ {gb(r.memory)}</span>} level="warn" note="for full GPU speed" />
        )}
        <Meter
          icon={<IconDisk />}
          label="Disk"
          value={of(r.weights, system.diskFree)}
          pct={installed ? undefined : (r.weights / system.diskFree) * 100}
          level={diskLevel}
          note={installed ? "already installed" : r.diskOk ? `${formatBytes(system.diskFree - r.weights)} left after` : "not enough space"}
        />
        <Meter
          icon={<IconGauge />}
          label="Speed"
          value={r.tokensPerSec > 0 ? <><span className="font-semibold text-white">~{Math.round(r.tokensPerSec)}</span> <span className="text-base text-zinc-500">tok/s</span></> : <span className="text-zinc-500">—</span>}
          level="good"
          note={r.tokensPerSec > 0 ? `estimate · ${speed}` : r.apple && !r.fullGpu ? "much slower on CPU" : "no estimate"}
        />
      </div>
      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        <span className="rounded-lg bg-white/5 px-3 py-1 text-zinc-300 ring-1 ring-white/10">
          Min RAM <b className="font-mono text-white">{gb(r.minRam)}</b>
        </span>
        <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/10 px-3 py-1 text-emerald-300 ring-1 ring-emerald-500/20">
          <IconCheck /> Recommended <b className="font-mono">{gb(r.recRam)}</b>
        </span>
      </div>
    </div>
  );
}
