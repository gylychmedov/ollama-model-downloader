import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, chatHref, displayName } from "../lib/api";
import { formatBytes } from "../lib/format";
import { useDashboard, useInstalledDetail, useLiveStats } from "../lib/hooks";
import { fitStyles, formatTokens, memoryFit, strengths } from "../lib/insights";
import { CapabilityBadge, Card, EmptyState, ModelAvatar } from "../components/ui";
import DeleteModelButton from "../components/DeleteModelButton";
import UpdateButton, { UpdateBadge } from "../components/UpdateButton";
import { IconAlert, IconArrowLeft, IconBolt, IconChat, IconChevronDown, IconExternal, IconStar, IconTerminal } from "../components/icons";

function Spec({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3" title={hint}>
      <div className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-1 truncate font-mono text-lg font-semibold text-white">{value}</div>
    </div>
  );
}

function Collapsible({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="overflow-hidden">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-5 py-3.5 text-left text-sm font-medium hover:bg-white/[0.03]">
        {title}
        <IconChevronDown className={`transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="border-t border-white/[0.06] px-5 py-4">{children}</div>}
    </Card>
  );
}

const heading = "mt-10 mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500";

export default function InstalledModelPage() {
  const { ns, name, tag = "" } = useParams();
  const model = `${ns}/${name}`;
  const navigate = useNavigate();
  const { data: d, isLoading, error } = useInstalledDetail(model, tag);
  const { data: dash } = useDashboard();
  useLiveStats();
  const { data: info } = useQuery({ queryKey: ["info", model], queryFn: () => api.info(model), staleTime: 10 * 60_000, retry: false });

  if (isLoading) return <div className="h-64 animate-pulse rounded-2xl bg-white/5" />;
  if (error || !d)
    return (
      <EmptyState icon="!" title="Model not found">
        {(error as Error)?.message} · <Link to="/dashboard" className="text-emerald-400 hover:underline">Back to dashboard</Link>
      </EmptyState>
    );

  const full = `${displayName(model)}:${tag}`;
  const caps = [...new Set([...d.capabilities, ...(info?.capabilities ?? [])])].filter((c) => c !== "completion");
  const fit = dash ? memoryFit(d.size, dash.system.memoryTotal) : null;
  const loaded = dash?.ollama.loaded.find((l) => l.name === full || l.name === `${model}:${tag}`);
  const list = strengths(caps, d.arch, d.parameterSize, d.quantization);
  const sorted = [...(dash?.models ?? [])].sort((a, b) => b.size - a.size);
  const rank = sorted.findIndex((m) => m.name === d.name) + 1;
  const a = d.arch;

  return (
    <div>
      <Link to="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-zinc-400 transition hover:text-white">
        <IconArrowLeft /> Back to dashboard
      </Link>

      <Card className="relative mt-4 overflow-hidden p-6 sm:p-8">
        <div className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
          <ModelAvatar name={model} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="text-xs text-zinc-500">
              Installed {new Date(d.modifiedAt).toLocaleDateString()} · ID <span className="font-mono">{d.id}</span>
            </div>
            <h1 className="mt-0.5 truncate text-3xl font-semibold tracking-tight">{full}</h1>
            {(info?.summary || a?.name) && <p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-400">{info?.summary || a?.name}</p>}
            <div className="mt-3 flex flex-wrap gap-1.5">
              <UpdateBadge model={model} tag={tag} />
              {caps.map((c) => <CapabilityBadge key={c} cap={c} />)}
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
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <div className="text-3xl font-semibold tracking-tight">{formatBytes(d.size)}</div>
            {rank > 0 && <div className="text-xs text-zinc-500">#{rank} largest of {sorted.length} models</div>}
            <div className="mt-1 flex flex-wrap gap-2">
              <UpdateButton model={model} tag={tag} />
              <Link to={chatHref(model, tag)} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3.5 py-2 text-sm font-medium text-zinc-950 transition hover:bg-emerald-400">
                <IconChat /> Try it
              </Link>
              <Link to={`/m/${model}`} className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-sm font-medium transition hover:bg-white/10">
                <IconExternal /> Library page
              </Link>
              <DeleteModelButton model={model} tag={tag} size={d.uniqueBytes} label onDeleted={() => navigate("/dashboard")} />
            </div>
          </div>
        </div>
        <div className="relative mt-6 flex items-center gap-2 rounded-xl border border-white/[0.06] bg-black/30 px-3 py-2 font-mono text-xs text-zinc-300">
          <IconTerminal className="text-emerald-400" /> ollama run {full}
        </div>
      </Card>

      {list.length > 0 && (
        <>
          <h2 className={`${heading} flex items-center gap-2`}><IconStar /> Strengths</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((s) => (
              <Card key={s.title} className="p-4">
                <div className="font-semibold tracking-tight text-white">{s.title}</div>
                <div className="mt-1 text-sm text-zinc-400">{s.detail}</div>
              </Card>
            ))}
          </div>
        </>
      )}

      <h2 className={heading}>Specs</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Spec label="Parameters" value={d.parameterSize || "—"} />
        <Spec label="Quantization" value={d.quantization || "—"} />
        <Spec label="Context" value={a?.contextLength ? formatTokens(a.contextLength) : "—"} hint="Maximum tokens the model was trained to handle" />
        <Spec label="Family" value={d.family || a?.architecture || "—"} />
        <Spec label="Layers" value={a?.blockCount || "—"} hint="Transformer blocks" />
        <Spec label="Embedding" value={a?.embeddingLength || "—"} hint="Hidden size" />
        <Spec label="Attention heads" value={a?.headCount ? `${a.headCount}${a.headCountKv && a.headCountKv !== a.headCount ? ` / ${a.headCountKv} kv` : ""}` : "—"} />
        <Spec label="Vocabulary" value={a?.vocabSize ? a.vocabSize.toLocaleString() : "—"} />
        {a?.expertCount ? <Spec label="Experts" value={`${a.expertUsedCount}/${a.expertCount}`} /> : null}
        <Spec label="License" value={a?.license || "—"} />
        <Spec label="Format" value={d.format || "—"} />
        <Spec label="Frees on delete" value={formatBytes(d.uniqueBytes)} hint="Files shared with other models are kept" />
      </div>
      {d.archError && <p className="mt-2 text-xs text-zinc-500">Could not read model metadata: {d.archError}</p>}

      {fit && dash && (
        <>
          <h2 className={heading}>Fits this computer?</h2>
          <Card className="p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${fitStyles[fit.level]}`}>
                {fit.level === "good" ? <IconBolt /> : <IconAlert />} {fit.label}
              </span>
              <span className="text-zinc-400">
                ~{formatBytes(d.size * 1.2)} needed of {formatBytes(dash.system.memoryTotal)} RAM · {fit.detail}
              </span>
            </div>
            <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className={`h-full rounded-full ${fit.level === "good" ? "bg-emerald-500" : fit.level === "warn" ? "bg-amber-500" : "bg-red-500"}`}
                style={{ width: `${Math.min(100, ((d.size * 1.2) / dash.system.memoryTotal) * 100)}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-zinc-500">Estimate: model weights plus ~20% for context cache. Longer contexts need more.</p>
          </Card>
        </>
      )}

      <h2 className={heading}>Files</h2>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <tbody>
            {d.layers.map((l) => (
              <tr key={l.digest} className="border-b border-white/[0.04] last:border-0">
                <td className="px-5 py-2.5 font-medium capitalize">{l.kind}</td>
                <td className="hidden px-5 py-2.5 font-mono text-xs text-zinc-500 sm:table-cell">{l.digest.slice(7, 19)}</td>
                <td className="px-5 py-2.5 text-xs text-zinc-500">{l.shared && "shared"}</td>
                <td className="px-5 py-2.5 text-right font-mono text-zinc-300">{formatBytes(l.size)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="truncate border-t border-white/[0.06] px-5 py-2.5 font-mono text-xs text-zinc-500" title={d.path}>{d.path}</div>
      </Card>

      <div className="mt-10 grid gap-3">
        {d.params && Object.keys(d.params).length > 0 && (
          <Collapsible title="Default parameters">
            <div className="grid grid-cols-2 gap-2 font-mono text-xs sm:grid-cols-4">
              {Object.entries(d.params).map(([k, v]) => (
                <div key={k} className="rounded-lg bg-black/30 px-3 py-2"><span className="text-zinc-500">{k}</span> <span className="text-zinc-200">{JSON.stringify(v)}</span></div>
              ))}
            </div>
          </Collapsible>
        )}
        {d.system && <Collapsible title="System prompt"><pre className="whitespace-pre-wrap font-mono text-xs text-zinc-300">{d.system}</pre></Collapsible>}
        {d.template && <Collapsible title="Prompt template"><pre className="max-h-96 overflow-auto whitespace-pre-wrap font-mono text-xs text-zinc-300">{d.template}</pre></Collapsible>}
        {d.license && <Collapsible title="License"><pre className="max-h-96 overflow-auto whitespace-pre-wrap font-mono text-xs text-zinc-400">{d.license.trim()}</pre></Collapsible>}
      </div>
    </div>
  );
}
