# Ollama Downloader

Resumable downloader and installer for Ollama models, built for unstable connections.

- Browse and search the ollama.com library, including community models like `user/model`
- Choose a parameter size (2b, 9b, 27b, …) and then a variant
- Downloads use HTTP range requests over several parallel connections. Progress is saved in Postgres every 2s
- Pause and resume at any time. Dropped connections retry automatically. A connection that stalls for 45s is reopened. Restarting the backend picks up where it stopped
- Every blob is checked with sha256, then **Install** moves the blobs into Ollama's store and writes the manifest, so `ollama run` works right away

## Run

```bash
./start.sh
open http://localhost:3470
```

`start.sh` starts Docker Desktop if it isn't running, restarts the stack and waits until the backend is healthy. It reads an optional `.env` file for the variables below.

| Variable | Default | Meaning |
|---|---|---|
| `OLLAMA_MODELS_DIR` | `~/.ollama/models` | Ollama models directory (mounted into the backend) |
| `DOWNLOAD_CONNECTIONS` | `4` | Parallel connections per blob |
| `WEB_PORT` | `3470` | Frontend port |
| `API_PORT` | `8470` | Backend port |
| `DB_PORT` | `5470` | Postgres port |
| `REVEAL_PORT` | `8471` | Host reveal helper port (loopback only) |

Partial files are stored in `<models dir>/.downloader-staging/<id>/`. Because this is on the same disk as Ollama's store, installing is an instant rename rather than a copy.

**Show in Finder** opens the staging folder, or after install selects the model's manifest. The backend runs in Docker and can't open Finder itself, so `start.sh` builds and starts a small host process (`backend/cmd/reveal-helper`) on `127.0.0.1:$REVEAL_PORT`. The helper only opens paths inside the models dir. When you run the backend natively without `REVEAL_URL`, it opens the file manager directly.

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
| GET | `/api/downloads` | Downloads with live speed and retries |
| POST | `/api/downloads` | `{"model":"bonsai-2","tag":"27b"}` |
| POST | `/api/downloads/{id}/pause\|resume\|install\|reveal` | |
| DELETE | `/api/downloads/{id}` | Cancel and delete staged data |
