import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { displayName, streamChat, type ChatStats } from "../lib/api";
import { formatBytes } from "../lib/format";
import { useInstalledModels } from "../lib/hooks";
import { Card, EmptyState, ModelAvatar } from "../components/ui";
import { IconAlert, IconBolt, IconBrain, IconChat, IconChevronDown, IconClock, IconPlay, IconStop } from "../components/icons";

const btn = "inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition disabled:opacity-50";

const SAMPLES = [
  "Explain what a transformer model is in three sentences.",
  "Write a Python function that checks whether a string is a palindrome.",
  "İstanbul hakkında kısa bir paragraf yaz.",
  "List five creative names for a coffee shop.",
];

type Run = {
  status: "idle" | "running" | "done" | "error" | "stopped";
  text: string;
  thinking: string;
  chunks: number;
  startedAt: number;
  firstAt: number;
  endedAt: number;
  stats?: ChatStats;
  error?: string;
};

const idle: Run = { status: "idle", text: "", thinking: "", chunks: 0, startedAt: 0, firstAt: 0, endedAt: 0 };

function secs(ms: number) {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

function Stat({ label, value, hint, icon, accent }: { label: string; value: ReactNode; hint?: string; icon?: ReactNode; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3" title={hint}>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-zinc-500">{icon}{label}</div>
      <div className={`mt-1 truncate font-mono text-xl font-semibold ${accent ? "text-emerald-400" : "text-white"}`}>{value}</div>
    </div>
  );
}

export default function ChatPage() {
  const { data: models, isLoading } = useInstalledModels();
  const [params, setParams] = useSearchParams();
  const [prompt, setPrompt] = useState("");
  const [run, setRun] = useState<Run>(idle);
  const [showThinking, setShowThinking] = useState(false);
  const [now, setNow] = useState(0);
  const abort = useRef<AbortController | null>(null);

  const selected = models?.find((m) => m.model === params.get("model") && m.tag === params.get("tag")) ?? models?.[0];
  const running = run.status === "running";

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(t);
  }, [running]);

  const select = (key: string) => {
    const m = models?.find((x) => x.name === key);
    if (m) setParams({ model: m.model, tag: m.tag }, { replace: true });
  };

  const start = async () => {
    if (!selected || !prompt.trim() || running) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    const t0 = performance.now();
    setNow(t0);
    setShowThinking(false);
    setRun({ ...idle, status: "running", startedAt: t0 });
    try {
      await streamChat(selected.model, selected.tag, prompt, (e) => {
        setRun((r) => {
          const at = performance.now();
          if ("text" in e) {
            return {
              ...r,
              text: e.type === "token" ? r.text + e.text : r.text,
              thinking: e.type === "thinking" ? r.thinking + e.text : r.thinking,
              chunks: r.chunks + 1,
              firstAt: r.firstAt || at,
            };
          }
          if (e.type === "done") return { ...r, status: "done", stats: e.stats, endedAt: at };
          return { ...r, status: "error", error: e.error, endedAt: at };
        });
      }, ctrl.signal);
      setRun((r) => (r.status === "running" ? { ...r, status: "error", error: "The stream ended without a result", endedAt: performance.now() } : r));
    } catch (err) {
      const stopped = (err as Error).name === "AbortError";
      setRun((r) => ({ ...r, status: stopped ? "stopped" : "error", error: stopped ? undefined : (err as Error).message, endedAt: performance.now() }));
    }
  };

  if (isLoading) return <div className="h-64 animate-pulse rounded-2xl bg-white/5" />;
  if (!models?.length)
    return (
      <EmptyState icon={<IconChat />} title="No models installed">
        <Link to="/" className="text-emerald-400 hover:underline">Download one from the library</Link> to try it here.
      </EmptyState>
    );

  const end = run.endedAt || now;
  const s = run.stats;
  const liveRate = run.firstAt && run.chunks > 1 ? (run.chunks - 1) / ((end - run.firstAt) / 1000) : 0;
  const firstToken = s?.firstTokenMs ?? (run.firstAt ? run.firstAt - run.startedAt : 0);
  const waiting = running && !run.firstAt;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-semibold tracking-tight"><IconChat className="text-emerald-400" /> Try a model</h1>
          <p className="mt-1 text-sm text-zinc-400">Send one prompt to an installed model and see how fast it answers on this computer.</p>
        </div>
      </div>

      <Card className="mt-6 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {selected && <ModelAvatar name={selected.model} size="sm" />}
          <div className="relative min-w-0 flex-1">
            <select
              value={selected?.name}
              onChange={(e) => select(e.target.value)}
              disabled={running}
              className="w-full appearance-none truncate rounded-xl border border-white/10 bg-black/30 py-2.5 pr-9 pl-3 text-sm font-medium outline-none focus:border-emerald-500/50 disabled:opacity-60"
            >
              {models.map((m) => (
                <option key={m.name} value={m.name}>
                  {displayName(m.model)}:{m.tag} · {formatBytes(m.size)}{m.parameterSize ? ` · ${m.parameterSize}` : ""}
                </option>
              ))}
            </select>
            <IconChevronDown className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-zinc-500" />
          </div>
          {selected && (
            <Link to={`/installed/${selected.model}/${selected.tag}`} className="text-xs text-zinc-500 transition hover:text-white">
              Model details →
            </Link>
          )}
        </div>

        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              start();
            }
          }}
          rows={4}
          placeholder="Ask anything…"
          className="mt-4 w-full resize-y rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm leading-relaxed outline-none placeholder:text-zinc-600 focus:border-emerald-500/50"
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {SAMPLES.map((p) => (
            <button
              key={p}
              onClick={() => setPrompt(p)}
              disabled={running}
              className="max-w-64 truncate rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-xs text-zinc-400 transition hover:border-white/20 hover:text-white disabled:opacity-50"
            >
              {p}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-xs text-zinc-600 sm:inline">⌘↵ to run</span>
            {running ? (
              <button onClick={() => abort.current?.abort()} className={`${btn} border border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20`}>
                <IconStop /> Stop
              </button>
            ) : (
              <button onClick={start} disabled={!prompt.trim()} className={`${btn} bg-emerald-500 text-zinc-950 hover:bg-emerald-400`}>
                <IconPlay /> Run
              </button>
            )}
          </div>
        </div>
      </Card>

      {run.status !== "idle" && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat
              label="First token"
              icon={<IconClock />}
              value={firstToken ? secs(firstToken) : waiting ? secs(now - run.startedAt) : "—"}
              hint="Time from sending the prompt until the first token arrived, including loading the model"
            />
            <Stat
              label="Speed"
              icon={<IconBolt />}
              accent
              value={s ? `${s.tokensPerSec.toFixed(1)} t/s` : liveRate ? `~${liveRate.toFixed(1)} t/s` : "—"}
              hint="Output tokens per second while generating"
            />
            <Stat label="Output" value={s ? `${s.outputTokens} tok` : run.chunks ? `~${run.chunks} tok` : "—"} hint="Generated tokens" />
            <Stat label="Prompt" value={s ? `${s.promptPerSec.toFixed(0)} t/s` : "—"} hint={s ? `${s.promptTokens} prompt tokens read in ${secs(s.promptMs)}` : "Prompt processing speed"} />
            <Stat label="Load" value={s ? secs(s.loadMs) : "—"} hint="Time Ollama spent loading the model into memory. Near zero when it was already loaded." />
            <Stat label="Total" value={s ? secs(s.totalMs) : run.startedAt ? secs(end - run.startedAt) : "—"} />
          </div>

          {run.status === "error" && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-300">
              <IconAlert className="mt-0.5 shrink-0" />
              <span>{run.error}</span>
            </div>
          )}

          <Card className="mt-4 overflow-hidden">
            {run.thinking && (
              <div className="border-b border-white/[0.06]">
                <button onClick={() => setShowThinking(!showThinking)} className="flex w-full items-center gap-2 px-5 py-3 text-left text-xs font-medium text-amber-300/90 hover:bg-white/[0.03]">
                  <IconBrain /> {running && !run.text ? "Thinking…" : "Thought process"}
                  <IconChevronDown className={`ml-auto transition ${showThinking ? "rotate-180" : ""}`} />
                </button>
                {showThinking && <pre className="max-h-80 overflow-auto px-5 pb-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-zinc-500">{run.thinking}</pre>}
              </div>
            )}
            <div className="min-h-32 px-5 py-4 text-sm leading-relaxed whitespace-pre-wrap text-zinc-200">
              {run.text}
              {waiting && <span className="text-zinc-500">Waiting for the first token… the first run may need to load the model into memory.</span>}
              {running && <span className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse bg-emerald-400" />}
            </div>
            {(run.status === "stopped" || s?.doneReason === "length") && (
              <div className="border-t border-white/[0.06] px-5 py-2 text-xs text-zinc-500">
                {run.status === "stopped" ? "Stopped. Final stats are only available for complete answers." : "Stopped at the model's output length limit."}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
