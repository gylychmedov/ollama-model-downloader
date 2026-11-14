import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Download } from "./api";

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
    remove: useMutation({ mutationFn: api.remove, ...opts }),
  };
}
