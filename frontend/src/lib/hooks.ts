import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Dashboard, type Download, type LiveStats, type Settings, type TransferStatus } from "./api";

const ACTIVE: Download["status"][] = ["downloading", "installing"];

export function useDownloads() {
  return useQuery({
    queryKey: ["downloads"],
    queryFn: api.downloads,
    refetchInterval: (q) => (q.state.data?.some((d) => ACTIVE.includes(d.status)) ? 1000 : 5000),
  });
}

export function useInstalled() {
  return useQuery({ queryKey: ["installed"], queryFn: api.installed, refetchInterval: 10000 });
}

export function useDownloadActions() {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["downloads"] });
    qc.invalidateQueries({ queryKey: ["installed"] });
  };
  const opts = { onSettled: refresh };
  return {
    create: useMutation({ mutationFn: (v: { model: string; tag: string }) => api.createDownload(v.model, v.tag), ...opts }),
    pause: useMutation({ mutationFn: api.pause, ...opts }),
    resume: useMutation({ mutationFn: api.resume, ...opts }),
    install: useMutation({ mutationFn: api.install, ...opts }),
    reveal: useMutation({ mutationFn: api.reveal, onError: (e) => alert(e.message) }),
    remove: useMutation({ mutationFn: api.remove, ...opts }),
  };
}

export function useInstalledModels() {
  return useQuery({ queryKey: ["installed-models"], queryFn: api.installedModels, refetchInterval: 10000 });
}

export function useUpdates() {
  return useQuery({ queryKey: ["updates"], queryFn: () => api.updates(), staleTime: 5 * 60_000, refetchInterval: 30 * 60_000 });
}

export function useCheckUpdates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.updates(true),
    onSuccess: (data) => qc.setQueryData(["updates"], data),
    onError: (e: Error) => alert(e.message),
  });
}

export function useUpdateModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { model: string; tag: string }) => api.updateModel(v.model, v.tag),
    onError: (e: Error) => alert(e.message),
    onSettled: () => qc.invalidateQueries({ queryKey: ["downloads"] }),
  });
}

export function useDashboard() {
  return useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard, refetchInterval: 10000 });
}

/** Streams memory, disk and Ollama status every second into the dashboard query. Returns whether the stream is connected. */
export function useLiveStats() {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const es = new EventSource("/api/live");
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      const live: LiveStats = JSON.parse(e.data);
      setConnected(true);
      qc.setQueryData<Dashboard>(["dashboard"], (old) =>
        old && {
          ...old,
          system: { ...old.system, ...live.system, source: old.system.source === "host" ? live.system.source : old.system.source },
          ollama: live.ollama,
          storage: { ...old.storage, staging: live.staging },
        },
      );
    };
    return () => es.close();
  }, [qc]);
  return connected;
}

export function useInstalledDetail(model: string, tag: string) {
  return useQuery({ queryKey: ["installed-detail", model, tag], queryFn: () => api.installedDetail(model, tag), retry: false });
}

export function useDeleteModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { model: string; tag: string }) => api.deleteInstalled(v.model, v.tag),
    onError: (e: Error) => alert(e.message),
    onSettled: () => {
      for (const key of ["installed", "installed-models", "dashboard", "downloads", "transfers"]) qc.invalidateQueries({ queryKey: [key] });
    },
  });
}

const TRANSFER_BUSY: TransferStatus[] = ["exporting", "verifying", "installing", "copying"];

export function useTransfers() {
  return useQuery({
    queryKey: ["transfers"],
    queryFn: api.transfers,
    refetchInterval: (q) => (q.state.data?.packages.some((p) => TRANSFER_BUSY.includes(p.status)) ? 1000 : 3000),
  });
}

export function useTransferActions() {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["transfers"] });
    qc.invalidateQueries({ queryKey: ["installed"] });
    qc.invalidateQueries({ queryKey: ["installed-models"] });
  };
  const opts = { onSettled: refresh, onError: (e: Error) => alert(e.message) };
  return {
    exportModel: useMutation({ mutationFn: (v: { model: string; tag: string }) => api.exportModel(v.model, v.tag), ...opts }),
    install: useMutation({ mutationFn: api.installTransfer, ...opts }),
    reveal: useMutation({ mutationFn: api.revealTransfer, onError: (e) => alert(e.message) }),
    openDir: useMutation({ mutationFn: api.openTransferDir, onError: (e) => alert(e.message) }),
    remove: useMutation({ mutationFn: api.removeTransfer, ...opts }),
  };
}

export function useCleanup(days: number) {
  return useQuery({ queryKey: ["cleanup", days], queryFn: () => api.cleanup(days), refetchOnWindowFocus: false });
}

export function useRunCleanup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { ids: string[]; days: number }) => api.runCleanup(v.ids, v.days),
    onError: (e: Error) => alert(e.message),
    onSettled: () => {
      for (const key of ["cleanup", "installed", "installed-models", "dashboard", "downloads"]) qc.invalidateQueries({ queryKey: [key] });
    },
  });
}

export function useSettings() {
  return useQuery({ queryKey: ["settings"], queryFn: api.settings, staleTime: 60_000 });
}

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: Settings) => api.saveSettings(v),
    onMutate: (v) => qc.setQueryData(["settings"], v),
    onError: (e: Error) => {
      alert(e.message);
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onSuccess: (v) => qc.setQueryData(["settings"], v),
  });
}
