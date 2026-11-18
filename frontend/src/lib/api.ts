export type LibraryModel = {
  name: string;
  description: string;
  capabilities: string[];
  sizes: string[];
  pulls: string;
};

export type ModelInfo = {
  name: string;
  summary: string;
  downloads: string;
  updated: string;
  updatedAt: string;
  capabilities: string[];
  sizes: string[];
  readme: string;
  url: string;
};

export type ModelTag = {
  name: string;
  param: string;
  digest: string;
  size: string;
  context: string;
};

export type DownloadStatus =
  | "downloading"
  | "paused"
  | "completed"
  | "installing"
  | "installed"
  | "error";

export type Download = {
  id: number;
  model: string;
  tag: string;
  status: DownloadStatus;
  totalBytes: number;
  downloadedBytes: number;
  error: string;
  createdAt: string;
  updatedAt: string;
  live: {
    active: boolean;
    phase: string;
    downloadedBytes: number;
    speed: number;
    retries: number;
    lastError: string;
  } | null;
};

export type InstalledModel = {
  name: string;
  model: string;
  tag: string;
  size: number;
  modifiedAt: string;
  format: string;
  family: string;
  parameterSize: string;
  quantization: string;
};

export type ModelArch = {
  architecture: string;
  name: string;
  basename: string;
  sizeLabel: string;
  license: string;
  parameterCount: number;
  contextLength: number;
  embeddingLength: number;
  blockCount: number;
  headCount: number;
  headCountKv: number;
  expertCount: number;
  expertUsedCount: number;
  vocabSize: number;
  vision: boolean;
  pooling: boolean;
};

export type ModelDetail = InstalledModel & {
  id: string;
  host: string;
  path: string;
  capabilities: string[];
  layers: { kind: string; mediaType: string; digest: string; size: number; shared: boolean }[];
  uniqueBytes: number;
  params: Record<string, unknown> | null;
  template: string;
  system: string;
  license: string;
  arch: ModelArch | null;
  archError?: string;
};

export type SystemInfo = {
  hostname: string;
  os: string;
  osVersion: string;
  arch: string;
  cpu: string;
  cores: number;
  memoryTotal: number;
  memoryAvailable: number;
  diskTotal: number;
  diskFree: number;
  source: "host" | "container";
};

export type LoadedModel = { name: string; size: number; size_vram: number; expires_at: string; context_length?: number };

export type LiveStats = {
  system: Pick<SystemInfo, "memoryTotal" | "memoryAvailable" | "diskTotal" | "diskFree" | "source">;
  ollama: Dashboard["ollama"];
  staging: number;
};

export type Dashboard = {
  system: SystemInfo;
  ollama: { url: string; running: boolean; version: string; loaded: LoadedModel[] };
  modelsDir: string;
  storage: { models: number; staging: number };
  models: InstalledModel[];
};

export type TransferStatus = "copying" | "ready" | "verifying" | "installing" | "installed" | "exporting" | "error" | "invalid";

export type TransferPackage = {
  name: string;
  path: string;
  models: { name: string; host: string; size: number; installed: boolean }[];
  status: TransferStatus;
  totalBytes: number;
  presentBytes: number;
  progressBytes: number;
  progressTotal: number;
  error: string;
  modifiedAt: string;
};

export type Transfers = { dir: string; packages: TransferPackage[] };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? res.statusText);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const api = {
  library: (q: string, sort: string) => request<LibraryModel[]>(`/library?q=${encodeURIComponent(q)}&sort=${sort}`),
  info: (model: string) => request<ModelInfo>(`/models/${model}`),
  tags: (model: string) => request<{ name: string; tags: ModelTag[] }>(`/models/${model}/tags`),
  installed: () => request<string[]>("/installed"),
  downloads: () => request<Download[]>("/downloads"),
  createDownload: (model: string, tag: string) =>
    request<Download>("/downloads", { method: "POST", body: JSON.stringify({ model, tag }) }),
  pause: (id: number) => request<void>(`/downloads/${id}/pause`, { method: "POST" }),
  resume: (id: number) => request<void>(`/downloads/${id}/resume`, { method: "POST" }),
  install: (id: number) => request<void>(`/downloads/${id}/install`, { method: "POST" }),
  reveal: (id: number) => request<void>(`/downloads/${id}/reveal`, { method: "POST" }),
  remove: (id: number) => request<void>(`/downloads/${id}`, { method: "DELETE" }),
  installedModels: () => request<InstalledModel[]>("/installed/models"),
  installedDetail: (model: string, tag: string) =>
    request<ModelDetail>(`/installed/detail?model=${encodeURIComponent(model)}&tag=${encodeURIComponent(tag)}`),
  deleteInstalled: (model: string, tag: string) =>
    request<{ freedBytes: number }>(`/installed?model=${encodeURIComponent(model)}&tag=${encodeURIComponent(tag)}`, { method: "DELETE" }),
  dashboard: () => request<Dashboard>("/dashboard"),
  exportModel: (model: string, tag: string) =>
    request<{ name: string }>("/installed/export", { method: "POST", body: JSON.stringify({ model, tag }) }),
  transfers: () => request<Transfers>("/transfers"),
  openTransferDir: () => request<void>("/transfers/open", { method: "POST" }),
  installTransfer: (name: string) => request<void>(`/transfers/${encodeURIComponent(name)}/install`, { method: "POST" }),
  revealTransfer: (name: string) => request<void>(`/transfers/${encodeURIComponent(name)}/reveal`, { method: "POST" }),
  removeTransfer: (name: string) => request<void>(`/transfers/${encodeURIComponent(name)}`, { method: "DELETE" }),
};

/** Uploads one file of a model folder. Uses XHR because fetch has no upload progress. */
export function uploadTransferFile(pkg: string, path: string, file: File, onProgress: (loaded: number) => void, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/transfers/upload?package=${encodeURIComponent(pkg)}&path=${encodeURIComponent(path)}`);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      if (xhr.status < 300) return resolve();
      let msg = xhr.statusText;
      try {
        msg = JSON.parse(xhr.responseText).error ?? msg;
      } catch {
        /* not JSON */
      }
      reject(new Error(msg));
    };
    xhr.onerror = () => reject(new Error("Upload failed — is the backend running?"));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    signal.addEventListener("abort", () => xhr.abort());
    xhr.send(file);
  });
}

/** Folder name the backend uses for an exported model (mirrors transfer.ExportName). */
export const exportName = (model: string, tag: string) => `${model.replace(/^library\//, "").replaceAll("/", "-")}-${tag}`;

export const displayName = (model: string) => model.replace(/^library\//, "");
