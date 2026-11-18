import { Link } from "react-router-dom";
import { displayName, exportName, type InstalledModel, type TransferPackage } from "../lib/api";
import { formatBytes } from "../lib/format";
import { useInstalledModels, useTransferActions, useTransfers } from "../lib/hooks";
import ProgressBar from "../components/ProgressBar";
import DeleteModelButton from "../components/DeleteModelButton";
import { Card, EmptyState, ModelAvatar } from "../components/ui";
import { IconAlert, IconBox, IconCopy, IconFolder, IconTerminal, IconTrash, IconUsb } from "../components/icons";

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent);
const finder = isMac ? "Finder" : "the file manager";

function Steps({ dir }: { dir?: string }) {
  const steps = [
    <>Click <b className="text-zinc-200">Copy</b> on a model. Its files are gathered into one folder, which opens in {finder}.</>,
    <>Copy that folder to a USB drive (or a network share).</>,
    <>
      On the other computer, paste it into the transfer folder <code className="rounded bg-black/30 px-1 font-mono text-[11px] text-zinc-300">{dir ?? "…/transfer"}</code> or pick it with{" "}
      <b className="text-zinc-200">Choose folder…</b> on <Link to="/downloads" className="text-emerald-400 hover:underline">Downloads</Link>, then click Install. Without
      this app, follow README.txt inside the folder.
    </>,
  ];
  return (
    <Card className="mb-8 p-5">
      <div className="flex items-center gap-2 font-semibold tracking-tight">
        <IconUsb className="text-indigo-300" /> Move a model to another computer
      </div>
      <ol className="mt-3 grid gap-3 text-sm text-zinc-400 md:grid-cols-3">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-3">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-indigo-500/15 text-xs font-semibold text-indigo-300 ring-1 ring-inset ring-indigo-500/30">{i + 1}</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function ModelRow({ m, pkg }: { m: InstalledModel; pkg?: TransferPackage }) {
  const a = useTransferActions();
  const name = `${displayName(m.model)}:${m.tag}`;
  const preparing = pkg?.status === "exporting" || (a.exportModel.isPending && a.exportModel.variables?.model === m.model && a.exportModel.variables?.tag === m.tag);
  const ready = pkg && !preparing && pkg.status !== "error";
  const btn = "inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition disabled:opacity-50";

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-3">
        <ModelAvatar name={m.model} size="sm" />
        <div className="min-w-0 flex-1">
          <Link to={`/installed/${m.model}/${m.tag}`} className="block truncate font-semibold tracking-tight hover:text-emerald-400">{name}</Link>
          <div className="text-xs text-zinc-500">
            {formatBytes(m.size)}
            {m.parameterSize && ` · ${m.parameterSize}`}
            {m.quantization && ` · ${m.quantization}`} · installed {new Date(m.modifiedAt).toLocaleDateString()}
          </div>
        </div>
        <div className="flex gap-2">
          {ready && (
            <button disabled={a.reveal.isPending} onClick={() => a.reveal.mutate(pkg.name)} className={`${btn} border border-white/10 bg-white/5 hover:bg-white/10`}>
              <IconFolder /> {isMac ? "Show in Finder" : "Show in folder"}
            </button>
          )}
          <button
            disabled={preparing}
            title={ready ? "Prepare the folder again" : "Prepare a folder you can copy to another computer"}
            onClick={() => a.exportModel.mutate({ model: m.model, tag: m.tag })}
            className={`${btn} ${ready ? "border border-white/10 bg-white/5 px-2.5 hover:bg-white/10" : "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 hover:bg-indigo-400"}`}
          >
            <IconCopy /> {ready ? "" : preparing ? "Preparing…" : "Copy"}
          </button>
          {ready && (
            <button
              title="Remove the prepared folder"
              onClick={() => confirm(`Delete the prepared folder ${pkg.path}? The installed model stays in Ollama.`) && a.remove.mutate(pkg.name)}
              className={`${btn} px-2.5 text-zinc-500 hover:bg-red-500/10 hover:text-red-300`}
            >
              <IconTrash />
            </button>
          )}
          <DeleteModelButton model={m.model} tag={m.tag} size={m.size} label />
        </div>
      </div>

      {preparing && pkg && (
        <div className="mt-4">
          <ProgressBar value={pkg.progressTotal ? pkg.progressBytes / pkg.progressTotal : 0} active />
          <div className="mt-1.5 text-xs text-zinc-500">Preparing folder… it opens in {finder} when ready.</div>
        </div>
      )}
      {ready && (
        <div className="mt-4 truncate rounded-xl border border-indigo-500/20 bg-indigo-500/5 px-3 py-2 text-xs text-indigo-200" title={pkg.path}>
          Ready to copy: <span className="font-mono">{pkg.path}</span>
        </div>
      )}
      {pkg?.status === "error" && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          <IconAlert className="mt-0.5 shrink-0" />
          <span>{pkg.error}</span>
        </div>
      )}
      <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/[0.06] bg-black/30 px-3 py-2 font-mono text-xs text-zinc-300">
        <IconTerminal className="text-emerald-400" />
        ollama run {name}
      </div>
    </Card>
  );
}

export default function InstalledPage() {
  const { data, isLoading, error } = useInstalledModels();
  const { data: transfers } = useTransfers();
  const byName = new Map(transfers?.packages.map((p) => [p.name, p]));
  const total = data?.reduce((s, m) => s + m.size, 0) ?? 0;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Installed models</h1>
        <p className="mt-1 text-zinc-400">
          {data ? `${data.length} model${data.length === 1 ? "" : "s"} in Ollama · ${formatBytes(total)}` : "Models available to ollama run"}
        </p>
      </div>

      <Steps dir={transfers?.dir} />

      {isLoading && <div className="h-40 animate-pulse rounded-2xl bg-white/5" />}
      {error && <EmptyState icon="!" title="Could not load installed models">{(error as Error).message}</EmptyState>}
      {data?.length === 0 && (
        <EmptyState icon={<IconBox />} title="No models installed yet">
          <Link to="/" className="text-emerald-400 hover:underline">Browse the library</Link> or install one copied from another computer on{" "}
          <Link to="/downloads" className="text-emerald-400 hover:underline">Downloads</Link>.
        </EmptyState>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        {data?.map((m) => <ModelRow key={m.name} m={m} pkg={byName.get(exportName(m.model, m.tag))} />)}
      </div>
    </div>
  );
}
