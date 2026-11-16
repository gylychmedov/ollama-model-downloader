package config

import (
	"os"
	"path/filepath"
	"strconv"
)

type Config struct {
	Addr         string
	DatabaseURL  string
	ModelsDir    string
	StagingDir   string
	Connections  int
	OllamaWebURL string
	RegistryURL  string
	// RevealURL is the host reveal-helper; empty means open the file manager directly.
	RevealURL string
}

func Load() Config {
	home, _ := os.UserHomeDir()
	models := env("OLLAMA_MODELS_DIR", filepath.Join(home, ".ollama", "models"))
	conns, err := strconv.Atoi(env("DOWNLOAD_CONNECTIONS", "4"))
	if err != nil || conns < 1 {
		conns = 4
	}
	return Config{
		Addr:         env("ADDR", ":8470"),
		DatabaseURL:  env("DATABASE_URL", "postgres://ollama:ollama@localhost:5470/downloader?sslmode=disable"),
		ModelsDir:    models,
		StagingDir:   env("STAGING_DIR", filepath.Join(models, ".downloader-staging")),
		Connections:  conns,
		OllamaWebURL: env("OLLAMA_WEB_URL", "https://ollama.com"),
		RegistryURL:  env("OLLAMA_REGISTRY_URL", "https://registry.ollama.ai"),
		RevealURL:    os.Getenv("REVEAL_URL"),
	}
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
