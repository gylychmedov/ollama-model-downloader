import { Link } from "react-router-dom";
import DownloadCard from "../components/DownloadCard";
import { useDownloads } from "../lib/hooks";
import { formatBytes } from "../lib/format";
import { Card, EmptyState } from "../components/ui";
import { IconBolt, IconBox, IconCheck, IconDownload } from "../components/icons";

function Summary({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent: string }) {
  return (
    <Card className="flex items-center gap-4 p-5">
      <div className={`grid size-11 place-items-center rounded-xl text-lg ring-1 ring-inset ${accent}`}>{icon}</div>
      <div>
        <div className="text-2xl font-semibold tracking-tight">{value}</div>
        <div className="text-xs text-zinc-500">{label}</div>
      </div>
    </Card>
  );
}

export default function DownloadsPage() {
  const { data, isLoading, error } = useDownloads();
  const active = data?.filter((d) => d.status === "downloading") ?? [];
  const speed = active.reduce((s, d) => s + (d.live?.speed ?? 0), 0);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Downloads</h1>
        <p className="mt-1 text-zinc-400">Progress is saved continuously — pause, close the app or lose connection anytime.</p>
      </div>

      {data && data.length > 0 && (
        <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Summary icon={<IconDownload />} label="Active" value={String(active.length)} accent="bg-sky-500/10 text-sky-300 ring-sky-500/20" />
          <Summary icon={<IconBolt />} label="Total speed" value={`${formatBytes(speed)}/s`} accent="bg-emerald-500/10 text-emerald-300 ring-emerald-500/20" />
          <Summary icon={<IconCheck />} label="Ready to install" value={String(data.filter((d) => d.status === "completed").length)} accent="bg-teal-500/10 text-teal-300 ring-teal-500/20" />
          <Summary icon={<IconBox />} label="Installed" value={String(data.filter((d) => d.status === "installed").length)} accent="bg-violet-500/10 text-violet-300 ring-violet-500/20" />
        </div>
      )}

      {isLoading && <div className="h-40 animate-pulse rounded-2xl bg-white/5" />}
      {error && <EmptyState icon="!" title="Could not load downloads">{(error as Error).message}</EmptyState>}
      {data?.length === 0 && (
        <EmptyState icon={<IconDownload />} title="No downloads yet">
          <Link to="/" className="text-emerald-400 hover:underline">Browse the library</Link> to start one.
        </EmptyState>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        {data?.map((d) => <DownloadCard key={d.id} d={d} />)}
      </div>
    </div>
  );
}
