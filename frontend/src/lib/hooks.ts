import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Download, type TransferStatus } from "./api";

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
