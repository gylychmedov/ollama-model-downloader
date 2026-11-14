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
  remove: (id: number) => request<void>(`/downloads/${id}`, { method: "DELETE" }),
};

export const displayName = (model: string) => model.replace(/^library\//, "");
