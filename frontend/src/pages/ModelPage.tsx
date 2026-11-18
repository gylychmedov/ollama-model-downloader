import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, displayName, type LibraryModel, type ModelTag } from "../lib/api";
import { paramValue } from "../lib/format";
import { useDashboard, useDownloadActions, useDownloads, useInstalled } from "../lib/hooks";
import { contextLabel, fitStyles, humanizeTag, parseSize, requirements, speedVerdict } from "../lib/insights";
import VariantRequirements, { FitBadge, MachineSummary } from "../components/RequirementsCard";
import DownloadCard from "../components/DownloadCard";
import { CapabilityBadge, Card, EmptyState, ModelAvatar } from "../components/ui";
import { IconArrowLeft, IconArrowRight, IconBook, IconBox, IconCheck, IconClock, IconDisk, IconDownload, IconExternal, IconLayers, IconSearch } from "../components/icons";
import Readme from "../components/Readme";

export default function ModelPage() {
  const { ns, name } = useParams();
  const model = `${ns}/${name}`;
  const qc = useQueryClient();
  const cached = qc
    .getQueriesData<LibraryModel[]>({ queryKey: ["library"] })
    .flatMap(([, d]) => d ?? [])
    .find((m) => m.name === model);
  const { data: info, isLoading: infoLoading } = useQuery({ queryKey: ["info", model], queryFn: () => api.info(model), staleTime: 10 * 60_000 });
  const description = info?.summary || cached?.description;
  const capabilities = info?.capabilities ?? cached?.capabilities ?? [];
  const downloads = info?.downloads || cached?.pulls;

  const { data, isLoading, error } = useQuery({ queryKey: ["tags", model], queryFn: () => api.tags(model), staleTime: 10 * 60_000 });
  const { data: downloadList } = useDownloads();
  const { data: installed } = useInstalled();
  const { create } = useDownloadActions();
  const { data: dash } = useDashboard();
  const [selected, setSelected] = useState<string | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, ModelTag[]>();
    for (const t of data?.tags ?? []) map.set(t.param, [...(map.get(t.param) ?? []), t]);
    return [...map.entries()].sort((a, b) => paramValue(a[0]) - paramValue(b[0]));
  }, [data]);

  const current = selected ?? groups.find(([p]) => p !== "latest")?.[0] ?? groups[0]?.[0];
  const tags = groups.find(([p]) => p === current)?.[1] ?? [];
  const [variant, setVariant] = useState<string | null>(null);
  const best = dash
    ? groups
        .filter(([p]) => p !== "latest" && p !== "other")
        .filter(([p, items]) => {
          const bytes = parseSize((items.find((t) => t.name === p) ?? items[0]).size);
          return bytes > 0 && requirements(bytes, dash.system).fit.level === "good";
        })
        .at(-1)?.[0]
    : undefined;
  const tag = tags.find((t) => t.name === variant) ?? tags.find((t) => t.name === current) ?? tags[0];
  const tagBytes = tag ? parseSize(tag.size) : 0;
  const tagHuman = tag ? humanizeTag(tag.name, current ?? "") : { title: "", chips: [] };
  const tagFit = dash && tagBytes ? requirements(tagBytes, dash.system).fit : null;
  const tagDl = tag && downloadList?.find((d) => d.model === model && d.tag === tag.name);
  const tagInstalled = tag && installed?.includes(`${model}:${tag.name}`);
  const starting = create.isPending && create.variables?.tag === tag?.name;

  return (
    <div>
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-zinc-400 transition hover:text-white">
        <IconArrowLeft /> Back to library
      </Link>

      <Card className="relative mt-4 overflow-hidden p-6 sm:p-8">
        <div className="pointer-events-none absolute -top-32 -left-24 size-96 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -right-24 -bottom-40 size-96 rounded-full bg-teal-500/5 blur-3xl" />
        <div className="relative grid items-center gap-8 xl:grid-cols-[minmax(0,1fr)_auto]">
          <div className="flex min-w-0 flex-col gap-6 sm:flex-row sm:items-start">
            <ModelAvatar name={model} size="xl" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">{displayName(model)}</h1>
                <span className="rounded-full bg-white/5 px-3 py-1 text-xs font-medium text-zinc-400 ring-1 ring-white/10">
                  {ns === "library" ? "Official library" : `by ${ns}`}
                </span>
              </div>
              {description && <p className="mt-3 max-w-4xl text-base leading-relaxed text-zinc-300 sm:text-lg">{description}</p>}
              <div className="mt-5 flex flex-wrap items-center gap-2">
                {capabilities.map((c) => <CapabilityBadge key={c} cap={c} large />)}
                <a
                  href={info?.url ?? `https://ollama.com/${model}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium text-emerald-400 transition hover:bg-emerald-500/10"
                >
                  <IconExternal /> ollama.com
                </a>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:w-[42rem]">
            {[
              { icon: <IconDownload />, value: downloads || "—", label: "Downloads" },
              { icon: <IconClock />, value: info?.updated || "—", label: "Last updated", title: info?.updatedAt },
              { icon: <IconLayers />, value: data ? groups.filter(([p]) => p !== "latest" && p !== "other").length : "—", label: "Sizes" },
              { icon: <IconBox />, value: data ? data.tags.length : "—", label: "Variants" },
            ].map((s) => (
              <div key={s.label} title={s.title} className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
                <div className="text-lg text-zinc-500">{s.icon}</div>
                <div className="mt-2 truncate text-xl font-semibold tracking-tight">{s.value}</div>
                <div className="text-xs text-zinc-500">{s.label}</div>
              </div>
            ))}
            {best && (
              <button
                onClick={() => {
                  setSelected(best);
                  setVariant(null);
                }}
                className="col-span-2 flex items-center justify-between gap-3 rounded-2xl border border-emerald-400/30 bg-gradient-to-r from-emerald-500/15 to-teal-500/10 px-4 py-3 text-left transition hover:border-emerald-400/60 sm:col-span-4"
              >
                <span>
                  <span className="block text-xs text-emerald-300/80">Best size for your machine</span>
                  <span className="font-mono text-xl font-semibold text-emerald-300">{best}</span>
                </span>
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-300">
                  {best === current ? <><IconCheck /> Selected</> : <>Select <IconArrowRight /></>}
                </span>
              </button>
            )}
          </div>
        </div>
      </Card>

      {isLoading && (
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-8">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-white/5" />)}
        </div>
      )}
      {error && <div className="mt-8"><EmptyState icon="!" title="Could not load tags">{(error as Error).message}</EmptyState></div>}
      {data && data.tags.length === 0 && <div className="mt-8"><EmptyState icon={<IconSearch />} title="No tags found" /></div>}

      {groups.length > 0 && (
        <>
          <h2 className="mt-10 mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Choose size</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-8">
            {groups.map(([param, items]) => {
              const base = items.find((t) => t.name === param) ?? items[0];
              const on = param === current;
              const hasInstalled = items.some((t) => installed?.includes(`${model}:${t.name}`));
              const bytes = parseSize(base.size);
              const fit = dash && bytes ? requirements(bytes, dash.system).fit : null;
              return (
                <button
                  key={param}
                  onClick={() => {
                    setSelected(param);
                    setVariant(null);
                  }}
                  className={`relative rounded-2xl border p-4 text-left transition ${
                    on
                      ? "border-emerald-400/60 bg-emerald-500/10 shadow-lg shadow-emerald-500/10 ring-1 ring-emerald-400/30"
                      : "border-white/[0.08] bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]"
                  }`}
                >
                  {hasInstalled && <IconCheck className="absolute top-3 right-3 text-emerald-400" />}
                  <div className={`font-mono text-xl font-semibold ${on ? "text-emerald-300" : "text-white"}`}>{param}</div>
                  <div className="mt-1 text-xs text-zinc-400">{base.size}</div>
                  <div className="text-[11px] text-zinc-500">
                    {items.length} variant{items.length > 1 ? "s" : ""}
                  </div>
                  {fit && (
                    <div className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${fitStyles[fit.level]}`} title={fit.detail}>
                      <span className="size-1.5 rounded-full bg-current" /> {fit.label}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {create.error && <p className="mt-3 text-sm text-red-400">{(create.error as Error).message}</p>}
        </>
      )}

      <div className="mt-10 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_26rem] 2xl:grid-cols-[minmax(0,1fr)_30rem]">
        <aside className="order-first lg:order-last lg:sticky lg:top-6">
          {tags.length > 0 && (
            <Card className="p-3">
              <div className="flex items-center justify-between px-2 pt-1 pb-2">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Variants · {current}</h2>
                <span className="text-[11px] text-zinc-500">{tags.length}</span>
              </div>
              <div className="-mx-1 flex max-h-[70vh] flex-col gap-1 overflow-y-auto p-1">
                {tags.map((t) => {
                  const on = t.name === tag?.name;
                  const bytes = parseSize(t.size);
                  const req = dash && bytes ? requirements(bytes, dash.system) : null;
                  const fit = req?.fit;
                  const dl = downloadList?.find((d) => d.model === model && d.tag === t.name);
                  const isInstalled = installed?.includes(`${model}:${t.name}`);
                  const human = humanizeTag(t.name, current ?? "");
                  return (
                    <button
                      key={t.name}
                      onClick={() => setVariant(t.name)}
                      title={`${displayName(model)}:${t.name}`}
                      className={`rounded-xl border px-3 py-2.5 text-left transition ${
                        on ? "border-emerald-400/40 bg-emerald-500/10" : "border-transparent hover:bg-white/[0.05]"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                          <span className={`text-sm font-semibold ${on ? "text-emerald-300" : "text-white"}`}>{human.title}</span>
                          {human.chips.map((c) => (
                            <span key={c} className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300 ring-1 ring-white/10">{c}</span>
                          ))}
                        </span>
                        {isInstalled && !dl ? (
                          <IconCheck className="shrink-0 text-emerald-400" />
                        ) : dl ? (
                          <span className="shrink-0 font-mono text-[11px] text-sky-300">{dl.totalBytes ? Math.floor(((dl.live?.downloadedBytes ?? dl.downloadedBytes) / dl.totalBytes) * 100) : 0}%</span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[11px] text-zinc-500">{t.name}</div>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
                        <span className="inline-flex items-center gap-2 text-xs text-zinc-400">
                          <span className="inline-flex items-center gap-1"><IconDisk className="text-zinc-500" /> {t.size}</span>
                          <span className="inline-flex items-center gap-1" title={contextLabel(t.context)}><IconBook className="text-zinc-500" /> {t.context}</span>
                        </span>
                        {req && fit && (
                          <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${fitStyles[fit.level]}`} title={`${fit.label} — ${fit.detail}`}>
                            <span className="size-1.5 rounded-full bg-current" /> {speedVerdict(req)}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </Card>
          )}
        </aside>

        <div className="min-w-0">
          {tag && (
            <Card className="relative overflow-hidden p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-xl font-semibold tracking-tight text-white">
                    {tagHuman.title}
                    {tagHuman.chips.map((c) => (
                      <span key={c} className="ml-2 rounded-md bg-white/5 px-2 py-0.5 align-middle text-xs font-medium text-zinc-300 ring-1 ring-white/10">{c}</span>
                    ))}
                  </div>
                  <div className="mt-1 truncate font-mono text-sm text-zinc-400">
                    {displayName(model)}:<span className="text-emerald-300">{tag.name}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-md bg-white/5 px-2 py-0.5 text-zinc-300 ring-1 ring-white/10">{tag.size}</span>
                    <span className="rounded-md bg-white/5 px-2 py-0.5 text-zinc-300 ring-1 ring-white/10">{contextLabel(tag.context)}</span>
                    <span className="rounded-md px-2 py-0.5 font-mono text-zinc-500">{tag.digest}</span>
                    {tagFit && <FitBadge fit={tagFit} />}
                  </div>
                </div>
                {tagInstalled && !tagDl ? (
                  <span className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-300 ring-1 ring-emerald-500/20">
                    <IconCheck /> Installed
                  </span>
                ) : !tagDl ? (
                  <button
                    disabled={create.isPending}
                    onClick={() => create.mutate({ model, tag: tag.name })}
                    className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-400 to-teal-500 px-4 py-2 text-sm font-semibold text-zinc-950 shadow-lg shadow-emerald-500/20 transition hover:brightness-110 disabled:opacity-50"
                  >
                    <IconDownload className={starting ? "animate-bounce" : ""} />
                    {starting ? "Starting…" : "Download"}
                  </button>
                ) : null}
              </div>
              {tagDl && (
                <div className="mt-4">
                  <DownloadCard d={tagDl} compact />
                </div>
              )}
              {dash && (
                <div className="mt-4">
                  <MachineSummary system={dash.system} />
                </div>
              )}
              {dash && tagBytes > 0 && <VariantRequirements size={tagBytes} system={dash.system} installed={!!tagInstalled} />}
            </Card>
          )}
        <h2 className="mt-8 mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          <IconBook /> Readme
        </h2>
        {infoLoading && <div className="h-48 animate-pulse rounded-2xl bg-white/5" />}
        {info && !info.readme && <Card className="p-6 text-sm text-zinc-500">This model has no readme.</Card>}
        {info?.readme && (
          <Card className="readme-card p-6 sm:p-8">
            <Readme html={info.readme} />
          </Card>
        )}
        </div>
      </div>
    </div>
  );
}
