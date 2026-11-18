import type { ReactNode } from "react";
import { IconBolt, IconBrain, IconCloud, IconEye, IconLayers, IconMic, IconWrench } from "./icons";

const gradients = [
  "from-emerald-400 to-teal-600",
  "from-sky-400 to-indigo-600",
  "from-fuchsia-400 to-purple-600",
  "from-amber-300 to-orange-600",
  "from-rose-400 to-pink-600",
  "from-lime-300 to-green-600",
  "from-cyan-300 to-blue-600",
  "from-violet-400 to-indigo-700",
];

function hash(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

export function ModelAvatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" | "xl" }) {
  const short = name.split("/").pop() ?? name;
  const letters = short.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase();
  const dims = { sm: "size-9 text-xs rounded-lg", md: "size-11 text-sm rounded-xl", lg: "size-16 text-xl rounded-2xl", xl: "size-20 text-2xl rounded-3xl sm:size-24 sm:text-3xl" }[size];
  return (
    <div className={`grid shrink-0 place-items-center bg-gradient-to-br font-bold text-[#fff] shadow-lg shadow-black/30 ring-1 ring-white/20 ${dims} ${gradients[hash(short) % gradients.length]}`}>
      {letters}
    </div>
  );
}

const capStyles: Record<string, { cls: string; icon: ReactNode }> = {
  tools: { cls: "bg-indigo-500/10 text-indigo-300 ring-indigo-500/20", icon: <IconWrench /> },
  vision: { cls: "bg-fuchsia-500/10 text-fuchsia-300 ring-fuchsia-500/20", icon: <IconEye /> },
  thinking: { cls: "bg-amber-500/10 text-amber-300 ring-amber-500/20", icon: <IconBrain /> },
  embedding: { cls: "bg-cyan-500/10 text-cyan-300 ring-cyan-500/20", icon: <IconLayers /> },
  cloud: { cls: "bg-sky-500/10 text-sky-300 ring-sky-500/20", icon: <IconCloud /> },
  audio: { cls: "bg-rose-500/10 text-rose-300 ring-rose-500/20", icon: <IconMic /> },
};

export function CapabilityBadge({ cap, large }: { cap: string; large?: boolean }) {
  const s = capStyles[cap] ?? { cls: "bg-zinc-500/10 text-zinc-300 ring-zinc-500/20", icon: <IconBolt /> };
  const dims = large ? "gap-1.5 px-3 py-1 text-sm" : "gap-1 px-2 py-0.5 text-[11px]";
  return (
    <span className={`inline-flex items-center rounded-full font-medium ring-1 ring-inset ${dims} ${s.cls}`}>
      {s.icon}
      {cap}
    </span>
  );
}

export function SizeChip({ children }: { children: ReactNode }) {
  return <span className="rounded-md bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300 ring-1 ring-inset ring-white/10">{children}</span>;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`card rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.05] to-white/[0.015] shadow-xl shadow-black/20 backdrop-blur ${className}`}>
      {children}
    </div>
  );
}

export function SkeletonCard() {
  return (
    <Card className="p-5">
      <div className="flex animate-pulse gap-3">
        <div className="size-11 rounded-xl bg-white/10" />
        <div className="flex-1 space-y-2 pt-1">
          <div className="h-3 w-1/2 rounded bg-white/10" />
          <div className="h-2.5 w-1/4 rounded bg-white/5" />
        </div>
      </div>
      <div className="mt-4 animate-pulse space-y-2">
        <div className="h-2.5 rounded bg-white/5" />
        <div className="h-2.5 w-4/5 rounded bg-white/5" />
      </div>
      <div className="mt-5 flex animate-pulse gap-2">
        <div className="h-5 w-14 rounded-full bg-white/5" />
        <div className="h-5 w-10 rounded-full bg-white/5" />
      </div>
    </Card>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <Card className="flex flex-col items-center px-6 py-16 text-center">
      <div className="grid size-14 place-items-center rounded-2xl bg-white/5 text-2xl text-zinc-400 ring-1 ring-white/10">{icon}</div>
      <h3 className="mt-4 font-semibold">{title}</h3>
      {children && <div className="mt-1 text-sm text-zinc-400">{children}</div>}
    </Card>
  );
}
