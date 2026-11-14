export function formatBytes(n: number): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / 1024 ** i).toFixed(i >= 3 ? 2 : i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function paramValue(param: string): number {
  if (param === "latest") return -1;
  const moe = param.match(/^(\d+)x(\d+(?:\.\d+)?)b$/);
  if (moe) return Number(moe[1]) * Number(moe[2]);
  const m = param.match(/^e?(\d+(?:\.\d+)?)([bm])$/);
  if (!m) return Number.MAX_SAFE_INTEGER;
  return Number(m[1]) * (m[2] === "m" ? 0.001 : 1);
}
