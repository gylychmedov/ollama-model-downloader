# Ollama Downloader

Resumable downloader and installer for Ollama models, built for unstable connections.

## Features

- **Browse the library** — search ollama.com, including community models like `user/model`
- **Download by parameter size** — pick a size (2b, 9b, 27b, …), then a variant
- **Resumable downloads** — pause and resume any time; progress is saved every 2s and survives a backend restart
- **Built for bad connections** — parallel HTTP range requests, automatic retries, and stalled connections reopened after 45s
- **Smart hardware check** — shows whether each size and variant fits your RAM, GPU and disk, with a speed estimate
- **Update check** — compares installed models with the registry and shows which ones have a newer version
- **Verified install** — every blob is checked with sha256, then installed into Ollama's store so `ollama run` works right away
- **Model library** — see installed models with size, family, quantization and architecture, and delete ones you no longer need
- **Notifications** — a browser or macOS notification when a download finishes, fails or gets installed, and an option to install into Ollama automatically
- **Try a model** — send one prompt to an installed model from the app and see the answer stream in, with time to first token, tokens per second, prompt speed and load time
- **Disk cleanup** — lists leftover staging folders, blobs no model uses and models you haven't run in a while, shows how much space each frees, and removes the selected ones in one click
- **Dashboard** — host CPU, memory and disk, Ollama status and loaded models
- **Move models between computers** — export a model to a folder, copy it on a USB drive, and install it on another machine
- **Show in Finder** — open a download's or an installed model's files
- **Light and dark mode**

## Run

```bash
./start.sh
open http://localhost:3470
```

`start.sh` starts Docker Desktop if it isn't running, rebuilds and recreates only the containers that changed, then waits until the backend is healthy. It reads an optional `.env` file for the variables below.

| Variable | Default | Meaning |
|---|---|---|
| `OLLAMA_MODELS_DIR` | `~/.ollama/models` | Ollama models directory (mounted into the backend) |
| `DOWNLOAD_CONNECTIONS` | `4` | Parallel connections per blob |
| `WEB_PORT` | `3470` | Frontend port |
| `API_PORT` | `8470` | Backend port |
| `DB_PORT` | `5470` | Postgres port |
| `REVEAL_PORT` | `8471` | Host reveal helper port (loopback only) |
| `OLLAMA_URL` | `http://host.docker.internal:11434` | Ollama server, used by the dashboard to show loaded models |

Partial files are stored in `<models dir>/.downloader-staging/<id>/`. Because this is on the same disk as Ollama's store, installing is an instant rename rather than a copy.

**Notifications** are set up on the Downloads page. Browser notifications are per browser and only work while a tab is open on `localhost` or https. macOS notifications are sent by the backend through the host helper, so they arrive with the browser closed. Turn on one or the other to avoid getting each alert twice. **Install automatically** installs every finished download; updates of installed models are always installed automatically.

**Show in Finder** opens the staging folder, or after install selects the model's manifest. The backend runs in Docker and can't open Finder or show notifications itself, so `start.sh` builds and starts a small host process (`backend/cmd/reveal-helper`) on `127.0.0.1:$REVEAL_PORT`. The helper only opens paths inside the models dir. When you run the backend natively without `REVEAL_URL`, it opens the file manager directly.

## Move a model to another computer

1. Click **N installed** in the header, then **Copy** on a model. The app puts the model's files in `<models dir>/transfer/<model>-<tag>/` and selects that folder in Finder. The files are hard links to Ollama's own blobs, so this is instant and takes no extra disk space.
2. Copy that folder to a USB drive.
3. On the other computer, paste it into `<models dir>/transfer/`. **Downloads** has an **Open in Finder** button for that folder. The model shows up there with an **Install** button. If the folder is somewhere else, like the Desktop, click **Choose folder…** and pick it. The browser then copies it into the transfer folder.

Install checks every blob with sha256, so a bad USB copy gets caught. It then moves the blobs into Ollama's store, writes the manifest and deletes the folder. The folder uses the same layout as Ollama's models dir (`blobs/`, `manifests/…`), so you can also install it without this app: run `cp -R blobs manifests ~/.ollama/models/` from inside the folder. `README.txt` in the folder explains this.

## Development

```bash
docker compose up -d db
cd backend && go run ./cmd/server          # :8470
cd frontend && npm install && npm run dev  # :3471, proxies /api to :8470
```

## API

| Method | Path | |
|---|---|---|
| GET | `/api/library?q=` | Library or search results |
| GET | `/api/models/{ns}/{name}/tags` | Tags with param size, size, context |
| GET | `/api/installed` | Models installed in Ollama |
| GET | `/api/installed/models` | Installed models with size, date, family, parameters and quantization |
| GET | `/api/installed/detail?model=&tag=` | Layers, architecture (read from the GGUF header), capabilities and parameters of one model |
| GET | `/api/updates` | Installed models with a newer version in the registry |
| DELETE | `/api/installed?model=&tag=` | Deletes a model and the blobs no other model or pending download uses |
| GET | `/api/cleanup?days=30` | Reclaimable items: unfinished downloads, orphaned blobs, and models unused for `days` |
| POST | `/api/cleanup` | `{"ids":["blob:sha256:…"],"days":30}`, deletes the items that are still eligible after a fresh scan |
| POST | `/api/chat` | `{"model":"library/gemma3","tag":"27b","prompt":"…"}`, streams NDJSON events: `token`, `thinking`, then `done` with timings, or `error` |
| GET | `/api/dashboard` | Host CPU, memory and disk, Ollama status, storage used and installed models |
| POST | `/api/installed/export` | `{"model":"library/gemma3","tag":"27b"}`, prepares a transfer folder and reveals it |
| GET | `/api/transfers` | Transfer folder path and the model folders in it |
| POST | `/api/transfers/open` | Open the transfer folder in Finder |
| PUT | `/api/transfers/upload?package=&path=` | Upload one file of a model folder (raw body) |
| POST | `/api/transfers/{name}/install\|reveal` | |
| DELETE | `/api/transfers/{name}` | Delete a folder from the transfer folder |
| GET | `/api/settings` | `{"autoInstall":false,"notifyDesktop":false}` |
| PUT | `/api/settings` | Saves the same object |
| POST | `/api/settings/test-notification` | Sends a test macOS notification |
| GET | `/api/downloads` | Downloads with live speed and retries |
| POST | `/api/downloads` | `{"model":"bonsai-2","tag":"27b"}` |
| POST | `/api/downloads/{id}/pause\|resume\|install\|reveal` | |
| DELETE | `/api/downloads/{id}` | Cancel and delete staged data |
