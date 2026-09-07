package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
	_ "time/tzdata"

	"github.com/aleka7sk/bospa/server/internal/bospa"
)

func main() {
	cfg, err := bospa.LoadConfig()
	if err != nil {
		fatal("load config", err)
	}
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: cfg.LogLevel}))
	slog.SetDefault(logger)

	rootCtx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	store, err := bospa.OpenStore(rootCtx, cfg)
	if err != nil {
		fatal("open store", err)
	}
	defer store.Close()

	if cfg.AutoMigrate {
		if err := store.Migrate(rootCtx); err != nil {
			fatal("run migrations", err)
		}
	}
	if err := store.EnsureBootstrapOwner(rootCtx, cfg); err != nil {
		fatal("bootstrap owner", err)
	}

	api := bospa.NewAPI(cfg, store, logger)
	server := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           api.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       75 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	go func() {
		logger.Info("bospa api started", "addr", cfg.HTTPAddr)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("http server stopped unexpectedly", "error", err)
			stop()
		}
	}()

	cleanupTicker := time.NewTicker(6 * time.Hour)
	defer cleanupTicker.Stop()
	go func() {
		for {
			select {
			case <-rootCtx.Done():
				return
			case <-cleanupTicker.C:
				ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
				if err := store.DeleteExpiredSessions(ctx); err != nil {
					logger.Warn("session cleanup failed", "error", err)
				}
				cancel()
			}
		}
	}()

	<-rootCtx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("graceful shutdown failed", "error", err)
	} else {
		logger.Info("bospa api stopped")
	}
}

func fatal(message string, err error) {
	slog.Error(message, "error", err)
	os.Exit(1)
}
