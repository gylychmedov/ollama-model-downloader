import type { ModelArch } from "./api";

export type Fit = { level: "good" | "warn" | "bad"; label: string; detail: string };

/** Rough memory check: weights plus ~20% for context cache and runtime. */
export function memoryFit(size: number, memoryTotal: number): Fit | null {
  if (!memoryTotal) return null;
  const need = size * 1.2;
  const pct = Math.round((need / memoryTotal) * 100);
  if (need <= memoryTotal * 0.5) return { level: "good", label: "Runs comfortably", detail: `needs ~${pct}% of RAM` };
  if (need <= memoryTotal * 0.75) return { level: "good", label: "Fits in memory", detail: `needs ~${pct}% of RAM` };
  if (need <= memoryTotal) return { level: "warn", label: "Tight fit", detail: `needs ~${pct}% of RAM — close other apps` };
  return { level: "bad", label: "Too large for RAM", detail: `needs ~${pct}% of RAM — will be very slow` };
}

/** Parses "27.3B" / "566.70M" into billions of parameters. */
export function paramBillions(s: string, count = 0): number {
  if (count > 0) return count / 1e9;
  const m = s.match(/^([\d.]+)\s*([BMK])$/i);
  if (!m) return 0;
  return Number(m[1]) * ({ B: 1, M: 1e-3, K: 1e-6 }[m[2].toUpperCase() as "B" | "M" | "K"]);
}

export function formatTokens(n: number): string {
  if (n >= 1024 * 1024 && n % (1024 * 1024) === 0) return `${n / (1024 * 1024)}M`;
  if (n >= 1000) return `${Math.round(n / (n % 1024 === 0 ? 1024 : 1000))}K`;
  return String(n);
}

export function quantInfo(q: string): string {
  const u = q.toUpperCase();
  if (u === "F32") return "32-bit full precision — maximum quality, largest size";
  if (u === "F16" || u === "BF16") return "16-bit precision — original quality, no compression loss";
  if (u.startsWith("Q8")) return "8-bit — practically lossless, half the size of 16-bit";
  if (u.startsWith("Q6")) return "6-bit — very close to original quality";
  if (u.startsWith("Q5")) return "5-bit — high quality with good compression";
  if (u.startsWith("Q4") || u.includes("MXFP4")) return "4-bit — ~70% smaller than 16-bit with small quality loss";
  if (u.startsWith("Q3") || u.startsWith("Q2") || u.startsWith("IQ")) return "Low-bit — very compact, noticeable quality loss";
  return "";
}

export type Strength = { title: string; detail: string };

export function strengths(caps: string[], arch: ModelArch | null, paramSize: string, quant: string): Strength[] {
  const out: Strength[] = [];
  const b = paramBillions(paramSize, arch?.parameterCount);
  if (b > 0) {
    const label = b >= 1 ? `${+b.toFixed(1)}B` : `${Math.round(b * 1000)}M`;
    if (b < 3) out.push({ title: `Tiny & fast (${label})`, detail: "Instant replies, runs on almost any machine. Best for simple tasks." });
    else if (b < 10) out.push({ title: `Small & quick (${label})`, detail: "Fast everyday assistant with solid quality." });
    else if (b < 40) out.push({ title: `Mid-size (${label})`, detail: "Strong reasoning and writing quality, needs a capable machine." });
    else out.push({ title: `Large (${label})`, detail: "Top-tier quality among local models; needs lots of memory." });
  }
  if (arch?.expertCount) {
    out.push({ title: "Mixture of experts", detail: `Uses ${arch.expertUsedCount || "a few"} of ${arch.expertCount} experts per token — fast for its size.` });
  }
  if (arch && arch.contextLength >= 32000) {
    const pages = Math.round((arch.contextLength * 0.75) / 500);
    out.push({ title: `${arch.contextLength >= 128000 ? "Long" : "Large"} context (${formatTokens(arch.contextLength)} tokens)`, detail: `Can take in about ${pages.toLocaleString()} pages of text at once.` });
  }
  const capText: Record<string, Strength> = {
    vision: { title: "Vision", detail: "Understands images: screenshots, photos, charts, documents." },
    tools: { title: "Tool calling", detail: "Can call functions and APIs — good for agents and automation." },
    thinking: { title: "Reasoning", detail: "Thinks step by step before answering hard problems." },
    embedding: { title: "Embeddings", detail: "Turns text into vectors for semantic search and RAG." },
    insert: { title: "Code fill-in", detail: "Completes code in the middle of a file (FIM)." },
    audio: { title: "Audio", detail: "Understands spoken audio input." },
  };
  for (const c of caps) if (capText[c]) out.push(capText[c]);
  const q = quantInfo(quant);
  if (q) out.push({ title: `Quantization ${quant}`, detail: q });
  return out;
}

export const fitStyles: Record<Fit["level"], string> = {
  good: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/25",
  warn: "bg-amber-500/10 text-amber-300 ring-amber-500/25",
  bad: "bg-red-500/10 text-red-300 ring-red-500/25",
};
