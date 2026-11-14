import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type LibraryModel } from "../lib/api";
import { useInstalled } from "../lib/hooks";
import { paramValue } from "../lib/format";
import { IconArrowRight, IconCheck, IconChevronDown, IconDownload, IconSearch, IconSort } from "../components/icons";
import { CapabilityBadge, Card, EmptyState, ModelAvatar, SizeChip, SkeletonCard } from "../components/ui";

const SORTS = [
  ["popular", "Most popular"],
  ["newest", "Newest"],
  ["name", "Name A–Z"],
  ["largest", "Largest size"],
  ["smallest", "Smallest size"],
] as const;

function minSize(m: LibraryModel) {
  const sizes = m.sizes.map(paramValue).filter((n) => n >= 0 && n < 1e9);
  return sizes.length ? Math.min(...sizes) : Number.MAX_SAFE_INTEGER;
}

function ModelCard({ m, installed }: { m: LibraryModel; installed: boolean }) {
  const [ns, short] = m.name.split("/");
  const sizes = m.sizes.slice(0, 5);
  return (
    <Link to={`/m/${m.name}`} className="group block h-full">
      <Card className="relative flex h-full flex-col p-5 transition duration-300 group-hover:-translate-y-1 group-hover:border-emerald-500/30 group-hover:shadow-emerald-500/10">
        <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br from-emerald-500/0 to-emerald-500/0 transition duration-300 group-hover:from-emerald-500/[0.06]" />

        <div className="relative flex items-start gap-3">
          <ModelAvatar name={m.name} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-semibold tracking-tight text-white">{short}</h2>
            <p className="truncate text-xs text-zinc-500">{ns === "library" ? "Official library" : `by ${ns}`}</p>
          </div>
          {installed ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
              <IconCheck /> Installed
            </span>
          ) : (
            <span className="grid size-8 place-items-center rounded-full bg-white/5 text-zinc-400 opacity-0 ring-1 ring-white/10 transition group-hover:translate-x-0.5 group-hover:opacity-100">
              <IconArrowRight />
            </span>
          )}
        </div>

        <p className="relative mt-4 line-clamp-2 flex-1 text-sm leading-relaxed text-zinc-400">{m.description || "No description provided."}</p>

        {m.capabilities.length > 0 && (
          <div className="relative mt-4 flex flex-wrap gap-1.5">
            {m.capabilities.map((c) => <CapabilityBadge key={c} cap={c} />)}
          </div>
        )}

        <div className="relative mt-4 flex items-center justify-between gap-3 border-t border-white/[0.06] pt-4">
          <div className="flex flex-wrap gap-1">
            {sizes.map((s) => <SizeChip key={s}>{s}</SizeChip>)}
            {m.sizes.length > sizes.length && <SizeChip>+{m.sizes.length - sizes.length}</SizeChip>}
            {m.sizes.length === 0 && <span className="text-xs text-zinc-600">—</span>}
          </div>
          {m.pulls && (
            <span className="flex shrink-0 items-center gap-1 text-xs text-zinc-500">
              <IconDownload /> {m.pulls}
            </span>
          )}
        </div>
      </Card>
    </Link>
  );
}

export default function LibraryPage() {
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const [input, setInput] = useState(query);
  const [cap, setCap] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const setParamsRef = useRef(setParams);
  setParamsRef.current = setParams;
  useEffect(() => {
    const t = setTimeout(() => {
      setParamsRef.current(
        (prev) => {
          if ((prev.get("q") ?? "") === input) return prev;
          const next = new URLSearchParams(prev);
          if (input) next.set("q", input);
          else next.delete("q");
          return next;
        },
        { replace: true },
      );
    }, 400);
    return () => clearTimeout(t);
  }, [input]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement !== inputRef.current) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const sort = params.get("sort") ?? "popular";
  const serverSort = sort === "newest" ? "newest" : "popular";
  const setSort = (v: string) => {
    const next = new URLSearchParams(params);
    if (v === "popular") next.delete("sort");
    else next.set("sort", v);
    setParams(next, { replace: true });
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ["library", query, serverSort],
    queryFn: () => api.library(query, serverSort),
    staleTime: 10 * 60_000,
  });
  const { data: installed } = useInstalled();
  const installedModels = new Set(installed?.map((m) => m.split(":")[0]));

  const caps = useMemo(() => [...new Set(data?.flatMap((m) => m.capabilities))].sort(), [data]);
  const models = useMemo(() => {
    const list = cap ? data?.filter((m) => m.capabilities.includes(cap)) : data;
    if (!list || sort === "popular" || sort === "newest") return list;
    const short = (m: LibraryModel) => m.name.split("/")[1].toLowerCase();
    const maxSize = (m: LibraryModel) => Math.max(0, ...m.sizes.map(paramValue).filter((n) => n < 1e9));
    const sorted = [...list];
    if (sort === "name") sorted.sort((a, b) => short(a).localeCompare(short(b)));
    if (sort === "largest") sorted.sort((a, b) => maxSize(b) - maxSize(a));
    if (sort === "smallest") sorted.sort((a, b) => minSize(a) - minSize(b));
    return sorted;
  }, [data, cap, sort]);

  return (
    <div>
      <section className="mx-auto max-w-3xl pt-4 pb-10 text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
          <span className="size-1.5 rounded-full bg-emerald-400" /> Pause, resume, survive disconnects
        </span>
        <h1 className="mt-5 bg-gradient-to-b from-white to-zinc-400 bg-clip-text text-4xl font-semibold tracking-tight text-transparent sm:text-5xl">
          Find your next model
        </h1>
        <p className="mt-3 text-zinc-400">Browse the Ollama library and download with resumable, multi-connection transfers.</p>

        <div className="group relative mt-8">
          <div className="absolute -inset-0.5 rounded-2xl bg-gradient-to-r from-emerald-500/40 via-teal-500/20 to-indigo-500/40 opacity-0 blur transition group-focus-within:opacity-100" />
          <div className="relative flex items-center rounded-2xl border border-white/10 bg-zinc-900/90 px-4 shadow-2xl shadow-black/40">
            <IconSearch className="text-lg text-zinc-500" />
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Search models — qwen, llama, bonsai, user/model…"
              className="w-full bg-transparent px-3 py-4 outline-none placeholder:text-zinc-500"
            />
            <kbd className="hidden rounded-md border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-xs text-zinc-500 sm:block">/</kbd>
          </div>
        </div>
      </section>

      {(caps.length > 0 || data) && (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          {[null, ...caps].map((c) => (
            <button
              key={c ?? "all"}
              onClick={() => setCap(c)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium capitalize transition ${
                cap === c ? "bg-white text-zinc-900" : "border border-white/10 bg-white/[0.03] text-zinc-400 hover:border-white/20 hover:text-white"
              }`}
            >
              {c ?? "All"}
            </button>
          ))}
          <span className="ml-auto text-sm text-zinc-500">{models?.length ?? 0} models</span>
          <label className="relative flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] py-1.5 pr-3 pl-3.5 text-sm text-zinc-400 transition hover:border-white/20">
            <IconSort />
            <span className="hidden sm:inline">Sort by</span>
            <select value={sort} onChange={(e) => setSort(e.target.value)} className="cursor-pointer appearance-none bg-transparent pr-5 font-medium text-white outline-none">
              {SORTS.map(([v, label]) => <option key={v} value={v} className="bg-zinc-900">{label}</option>)}
            </select>
            <IconChevronDown className="pointer-events-none absolute right-3 text-xs" />
          </label>
        </div>
      )}

      {error && <EmptyState icon="!" title="Could not load models">{(error as Error).message}</EmptyState>}
      {models && models.length === 0 && <EmptyState icon={<IconSearch />} title="No models found">Try another search term.</EmptyState>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading && Array.from({ length: 9 }, (_, i) => <SkeletonCard key={i} />)}
        {models?.map((m) => <ModelCard key={m.name} m={m} installed={installedModels.has(m.name)} />)}
      </div>
    </div>
  );
}
