import { displayName } from "../lib/api";
import { formatBytes } from "../lib/format";
import { useDeleteModel } from "../lib/hooks";
import { IconTrash } from "./icons";

export default function DeleteModelButton({ model, tag, size, label = false, onDeleted }: { model: string; tag: string; size: number; label?: boolean; onDeleted?: () => void }) {
  const del = useDeleteModel();
  const name = `${displayName(model)}:${tag}`;
  const busy = del.isPending && del.variables?.model === model && del.variables?.tag === tag;
  return (
    <button
      disabled={busy}
      title={`Delete ${name}`}
      onClick={() => {
        if (!confirm(`Delete ${name} from Ollama?\n\nThis frees up to ${formatBytes(size)}. Files shared with other models are kept. You can download it again later.`)) return;
        del.mutate({ model, tag }, { onSuccess: () => onDeleted?.() });
      }}
      className={`inline-flex items-center gap-1.5 rounded-xl py-2 text-sm font-medium transition disabled:opacity-50 ${
        label ? "border border-red-500/25 bg-red-500/10 px-3.5 text-red-300 hover:bg-red-500/20" : "px-2.5 text-zinc-500 hover:bg-red-500/10 hover:text-red-300"
      }`}
    >
      <IconTrash /> {label && (busy ? "Deleting…" : "Delete")}
    </button>
  );
}
