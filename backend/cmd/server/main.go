package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/dagdan/ai-model-downloader/internal/api"
	"github.com/dagdan/ai-model-downloader/internal/config"
	"github.com/dagdan/ai-model-downloader/internal/downloader"
	"github.com/dagdan/ai-model-downloader/internal/library"
	"github.com/dagdan/ai-model-downloader/internal/registry"
	"github.com/dagdan/ai-model-downloader/internal/store"
)

func main() {
	cfg := config.Load()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := os.MkdirAll(cfg.StagingDir, 0o755); err != nil {
		log.Fatalf("staging dir: %v", err)
	}
	st, err := store.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer st.Close()

	reg := registry.New(cfg.RegistryURL)
	mgr := downloader.New(st, reg, cfg)
	if err := mgr.ResumeInterrupted(ctx); err != nil {
		log.Printf("resume interrupted downloads: %v", err)
	}

	lib := library.New(cfg.OllamaWebURL, st)
	go lib.Prewarm(ctx)
	srv := &http.Server{Addr: cfg.Addr, Handler: api.New(cfg, st, lib, reg, mgr)}
	go func() {
		log.Printf("listening on %s (models dir %s)", cfg.Addr, cfg.ModelsDir)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()

	<-ctx.Done()
	log.Print("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
	mgr.Shutdown()
}
