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

/** Parses ollama.com sizes like "17GB" or "292MB" into bytes. */
export function parseSize(s: string): number {
  const m = s.trim().match(/^([\d.]+)\s*([KMGT]?)B$/i);
  if (!m) return 0;
  return Number(m[1]) * 1000 ** "_KMGT".indexOf(m[2].toUpperCase() || "_");
}

const GB = 1024 ** 3;
const RAM_SIZES = [8, 16, 24, 32, 36, 48, 64, 96, 128, 192, 256, 512];

const appleBandwidth: [RegExp, number][] = [
  [/M1 Ultra|M2 Ultra/, 800], [/M3 Ultra/, 819], [/M4 Max/, 546], [/M[123] Max/, 400],
  [/M4 Pro/, 273], [/M[12] Pro/, 200], [/M3 Pro/, 150], [/M5/, 153], [/M4/, 120], [/M[23]/, 100], [/M1/, 68],
];

export type Requirements = {
  weights: number;
  memory: number;
  minRam: number;
  recRam: number;
  gpuLimit: number;
  apple: boolean;
  fullGpu: boolean;
  tokensPerSec: number;
  diskOk: boolean;
  fit: Fit;
};

export function requirements(size: number, sys: { arch: string; cpu: string; os: string; memoryTotal: number; diskFree: number }): Requirements {
  const memory = size * 1.2;
  const apple = sys.os === "macOS" && sys.arch === "arm64";
  const gpuLimit = apple ? sys.memoryTotal * (sys.memoryTotal > 36 * GB ? 0.75 : 0.67) : 0;
  const fullGpu = apple && memory <= gpuLimit;
  const pick = (ratio: number) => (RAM_SIZES.find((g) => memory <= g * GB * ratio) ?? 1024) * GB;
  const bw = apple ? appleBandwidth.find(([re]) => re.test(sys.cpu))?.[1] ?? 0 : 0;
  const tokensPerSec = bw && fullGpu ? (bw * 1e9 * 0.7) / size : 0;
  let fit = memoryFit(size, sys.memoryTotal) ?? { level: "warn", label: "Unknown", detail: "" };
  if (apple && fit.level !== "bad" && !fullGpu) fit = { level: "warn", label: "Partly on CPU", detail: "exceeds GPU memory limit — slower replies" };
  return { weights: size, memory, minRam: pick(0.75), recRam: pick(0.5), gpuLimit, apple, fullGpu, tokensPerSec, diskOk: size < sys.diskFree, fit };
}

function quantLabel(q: string): string {
  const u = q.toUpperCase();
  if (u === "QAT") return "4-bit QAT · quality-tuned";
  if (u === "FP32" || u === "F32") return "32-bit · full precision";
  if (u === "FP16" || u === "F16" || u === "BF16") return "16-bit · full quality";
  if (u === "MXFP4") return "4-bit MXFP4 · compact";
  if (u.startsWith("Q8")) return "8-bit · near lossless";
  if (u.startsWith("Q6")) return "6-bit · very high quality";
  if (u.startsWith("Q5")) return "5-bit · high quality";
  if (u === "Q4_K_M") return "4-bit · balanced";
  if (u.startsWith("Q4")) return "4-bit · compact";
  if (u.startsWith("Q3") || u.startsWith("IQ3")) return "3-bit · very compact";
  if (u.startsWith("Q2") || u.startsWith("IQ2") || u.startsWith("IQ1")) return "2-bit · smallest, lowest quality";
  return q;
}

const QUANT = /^(q\d\w*|iq\d\w*|fp16|bf16|fp32|f16|f32|mxfp4|qat)$/i;
const KIND: Record<string, string> = { it: "Instruct", instruct: "Instruct", chat: "Chat", text: "Base model", base: "Base model", vision: "Vision" };

/** Turns a tag like "1.5b-qwen-distill-q4_K_M" into a readable title plus descriptor chips. */
export function humanizeTag(name: string, param: string): { title: string; chips: string[] } {
  if (name === param) return { title: "Default · recommended", chips: [] };
  const rest = name.startsWith(`${param}-`) ? name.slice(param.length + 1) : name;
  const chips: string[] = [];
  let quant = "";
  let words: string[] = [];
  const flush = () => {
    if (words.length) chips.push(words.join(" ").replace(/^./, (c) => c.toUpperCase()));
    words = [];
  };
  for (const part of rest.split("-")) {
    if (QUANT.test(part)) {
      flush();
      quant = quant ? `${quant}-${part}` : part;
    } else if (KIND[part.toLowerCase()]) {
      flush();
      chips.push(KIND[part.toLowerCase()]);
    } else words.push(part);
  }
  flush();
  const q = quant.toLowerCase() === "qat" || quant.toLowerCase().includes("qat") ? "qat" : quant;
  return { title: q ? quantLabel(q) : chips.shift() ?? rest, chips };
}

/** "128K" → "128K context · ~190 pages" */
export function contextLabel(ctx: string): string {
  const m = ctx.trim().match(/^([\d.]+)\s*([KM]?)$/i);
  if (!m) return `${ctx} context`;
  const tokens = Number(m[1]) * ({ "": 1, K: 1000, M: 1e6 }[m[2].toUpperCase() as "" | "K" | "M"]);
  const pages = Math.round((tokens * 0.75) / 500);
  return `${ctx} context · ~${pages.toLocaleString()} pages`;
}

/** Short verdict with speed when known, e.g. "Fast · ~190 tok/s". */
export function speedVerdict(r: Requirements): string {
  if (r.fit.level === "bad") return "Won't fit in RAM";
  if (r.apple && !r.fullGpu) return "Slow · partly on CPU";
  const t = Math.round(r.tokensPerSec);
  if (!t) return r.fit.label;
  if (t >= 30) return `Fast · ~${t} tok/s`;
  if (t >= 12) return `Smooth · ~${t} tok/s`;
  if (t >= 5) return `Usable · ~${t} tok/s`;
  return `Slow · ~${t} tok/s`;
}
