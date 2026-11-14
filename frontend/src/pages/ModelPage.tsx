import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, displayName, type LibraryModel, type ModelTag } from "../lib/api";
import { paramValue } from "../lib/format";
import { useDownloadActions, useDownloads, useInstalled } from "../lib/hooks";
import DownloadCard from "../components/DownloadCard";
import { CapabilityBadge, Card, EmptyState, ModelAvatar } from "../components/ui";
import { IconArrowLeft, IconBook, IconCheck, IconChevronDown, IconClock, IconDownload, IconExternal, IconSearch } from "../components/icons";
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
  const [readmeOpen, setReadmeOpen] = useState(false);

  const { data, isLoading, error } = useQuery({ queryKey: ["tags", model], queryFn: () => api.tags(model), staleTime: 10 * 60_000 });
  const { data: downloadList } = useDownloads();
  const { data: installed } = useInstalled();
  const { create } = useDownloadActions();
  const [selected, setSelected] = useState<string | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, ModelTag[]>();
    for (const t of data?.tags ?? []) map.set(t.param, [...(map.get(t.param) ?? []), t]);
    return [...map.entries()].sort((a, b) => paramValue(a[0]) - paramValue(b[0]));
  }, [data]);

  const current = selected ?? groups.find(([p]) => p !== "latest")?.[0] ?? groups[0]?.[0];
  const tags = groups.find(([p]) => p === current)?.[1] ?? [];

  return (
    <div>
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-zinc-400 transition hover:text-white">
        <IconArrowLeft /> Back to library
      </Link>

      <Card className="relative mt-4 overflow-hidden p-6 sm:p-8">
        <div className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
          <ModelAvatar name={model} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="text-xs text-zinc-500">{ns === "library" ? "Official library" : `by ${ns}`}</div>
            <h1 className="mt-0.5 text-3xl font-semibold tracking-tight">{displayName(model)}</h1>
            {description && <p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-400">{description}</p>}
            {capabilities.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {capabilities.map((c) => <CapabilityBadge key={c} cap={c} />)}
              </div>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-zinc-400">
              {downloads && (
                <span className="inline-flex items-center gap-1.5"><IconDownload /> {downloads} downloads</span>
              )}
              {info?.updated && (
                <span className="inline-flex items-center gap-1.5" title={info.updatedAt}><IconClock /> Updated {info.updated}</span>
              )}
              <a href={info?.url ?? `https://ollama.com/${model}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-emerald-400 hover:underline">
                <IconExternal /> View on ollama.com
              </a>
            </div>
          </div>
          {data && (
            <div className="flex gap-6 sm:text-right">
              <div>
                <div className="text-2xl font-semibold">{groups.filter(([p]) => p !== "latest" && p !== "other").length}</div>
                <div className="text-xs text-zinc-500">sizes</div>
              </div>
              <div>
                <div className="text-2xl font-semibold">{data.tags.length}</div>
                <div className="text-xs text-zinc-500">variants</div>
              </div>
            </div>
          )}
        </div>
      </Card>

      {isLoading && (
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-white/5" />)}
        </div>
      )}
      {error && <div className="mt-8"><EmptyState icon="!" title="Could not load tags">{(error as Error).message}</EmptyState></div>}
      {data && data.tags.length === 0 && <div className="mt-8"><EmptyState icon={<IconSearch />} title="No tags found" /></div>}

      {groups.length > 0 && (
        <>
          <h2 className="mt-10 mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Choose size</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {groups.map(([param, items]) => {
              const base = items.find((t) => t.name === param) ?? items[0];
              const on = param === current;
              const hasInstalled = items.some((t) => installed?.includes(`${model}:${t.name}`));
              return (
                <button
                  key={param}
                  onClick={() => setSelected(param)}
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
                </button>
              );
            })}
          </div>

          <h2 className="mt-10 mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Variants · {current}</h2>
          <div className="grid gap-3 lg:grid-cols-2">
            {tags.map((t) => {
              const dl = downloadList?.find((d) => d.model === model && d.tag === t.name);
              const isInstalled = installed?.includes(`${model}:${t.name}`);
              const starting = create.isPending && create.variables?.tag === t.name;
              return (
                <Card key={t.name} className={`p-5 ${dl ? "lg:col-span-2" : ""}`}>
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="truncate font-mono font-semibold text-white">
                        {displayName(model)}:<span className="text-emerald-300">{t.name}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        <span className="rounded-md bg-white/5 px-2 py-0.5 text-zinc-300 ring-1 ring-white/10">{t.size}</span>
                        <span className="rounded-md bg-white/5 px-2 py-0.5 text-zinc-300 ring-1 ring-white/10">{t.context} ctx</span>
                        <span className="rounded-md px-2 py-0.5 font-mono text-zinc-500">{t.digest}</span>
                      </div>
                    </div>
                    {isInstalled && !dl ? (
                      <span className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-300 ring-1 ring-emerald-500/20">
                        <IconCheck /> Installed
                      </span>
                    ) : !dl ? (
                      <button
                        disabled={create.isPending}
                        onClick={() => create.mutate({ model, tag: t.name })}
                        className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-400 to-teal-500 px-4 py-2 text-sm font-semibold text-zinc-950 shadow-lg shadow-emerald-500/20 transition hover:brightness-110 disabled:opacity-50"
                      >
                        <IconDownload className={starting ? "animate-bounce" : ""} />
                        {starting ? "Starting…" : "Download"}
                      </button>
                    ) : null}
                  </div>
                  {dl && (
                    <div className="mt-4">
                      <DownloadCard d={dl} compact />
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
          {create.error && <p className="mt-3 text-sm text-red-400">{(create.error as Error).message}</p>}
        </>
      )}

      <h2 className="mt-10 mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        <IconBook /> Readme
      </h2>
      {infoLoading && <div className="h-48 animate-pulse rounded-2xl bg-white/5" />}
      {info && !info.readme && <Card className="p-6 text-sm text-zinc-500">This model has no readme.</Card>}
      {info?.readme && (
        <Card className="relative overflow-hidden p-6 sm:p-8">
          <div className={readmeOpen ? "" : "max-h-[28rem] overflow-hidden"}>
            <Readme html={info.readme} />
          </div>
          {!readmeOpen && info.readme.length > 1500 && (
            <div className="absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-zinc-950 via-zinc-950/90 to-transparent pt-24 pb-6">
              <button onClick={() => setReadmeOpen(true)} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-zinc-900 px-4 py-2 text-sm font-medium shadow-lg transition hover:border-white/25">
                Show full readme <IconChevronDown />
              </button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
