export default function ProgressBar({ value, active, tone = "emerald" }: { value: number; active?: boolean; tone?: "emerald" | "amber" | "red" | "zinc" }) {
  const colors = {
    emerald: "from-emerald-400 to-teal-400 shadow-[0_0_12px_rgba(52,211,153,0.5)]",
    amber: "from-amber-400 to-orange-400",
    red: "from-red-500 to-rose-400",
    zinc: "from-zinc-500 to-zinc-400",
  };
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/[0.06] ring-1 ring-inset ring-white/5">
      <div
        className={`h-full rounded-full bg-gradient-to-r transition-[width] duration-700 ${colors[tone]} ${active ? "progress-active" : ""}`}
        style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }}
      />
    </div>
  );
}
