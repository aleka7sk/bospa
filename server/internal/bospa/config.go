package bospa

import (
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	HTTPAddr            string
	DatabaseURL         string
	PublicOrigin        string
	AllowedOrigins      []string
	CookieSecure        bool
	SessionTTL          time.Duration
	AutoMigrate         bool
	LogLevel            slog.Level
	BootstrapEmail      string
	BootstrapPassword   string
	BootstrapName       string
	BootstrapWorkspace  string
	ShutdownTimeout     time.Duration
	DatabaseMaxConns    int32
	DatabaseMinConns    int32
	DatabaseMaxConnLife time.Duration
}

func LoadConfig() (Config, error) {
	cfg := Config{
		HTTPAddr:            env("BOSPA_HTTP_ADDR", ":8080"),
		DatabaseURL:         strings.TrimSpace(os.Getenv("BOSPA_DATABASE_URL")),
		PublicOrigin:        strings.TrimRight(env("BOSPA_PUBLIC_ORIGIN", "http://localhost:4173"), "/"),
		CookieSecure:        envBool("BOSPA_COOKIE_SECURE", false),
		SessionTTL:          envDuration("BOSPA_SESSION_TTL", 30*24*time.Hour),
		AutoMigrate:         envBool("BOSPA_AUTO_MIGRATE", true),
		BootstrapEmail:      strings.TrimSpace(strings.ToLower(os.Getenv("BOSPA_BOOTSTRAP_OWNER_EMAIL"))),
		BootstrapPassword:   os.Getenv("BOSPA_BOOTSTRAP_OWNER_PASSWORD"),
		BootstrapName:       env("BOSPA_BOOTSTRAP_OWNER_NAME", "Владелец Bospa"),
		BootstrapWorkspace:  env("BOSPA_BOOTSTRAP_WORKSPACE", "Bospa Demo"),
		ShutdownTimeout:     envDuration("BOSPA_SHUTDOWN_TIMEOUT", 15*time.Second),
		DatabaseMaxConns:    int32(envInt("BOSPA_DB_MAX_CONNS", 20)),
		DatabaseMinConns:    int32(envInt("BOSPA_DB_MIN_CONNS", 2)),
		DatabaseMaxConnLife: envDuration("BOSPA_DB_MAX_CONN_LIFETIME", 30*time.Minute),
	}

	if cfg.DatabaseURL == "" {
		return Config{}, fmt.Errorf("BOSPA_DATABASE_URL is required")
	}

	origins := env("BOSPA_ALLOWED_ORIGINS", cfg.PublicOrigin)
	for _, origin := range strings.Split(origins, ",") {
		origin = strings.TrimSpace(strings.TrimRight(origin, "/"))
		if origin != "" {
			cfg.AllowedOrigins = append(cfg.AllowedOrigins, origin)
		}
	}

	switch strings.ToLower(env("BOSPA_LOG_LEVEL", "info")) {
	case "debug":
		cfg.LogLevel = slog.LevelDebug
	case "warn", "warning":
		cfg.LogLevel = slog.LevelWarn
	case "error":
		cfg.LogLevel = slog.LevelError
	default:
		cfg.LogLevel = slog.LevelInfo
	}

	if (cfg.BootstrapEmail == "") != (cfg.BootstrapPassword == "") {
		return Config{}, fmt.Errorf("bootstrap email and password must be configured together")
	}
	if cfg.BootstrapPassword != "" && len(cfg.BootstrapPassword) < 12 {
		return Config{}, fmt.Errorf("bootstrap password must contain at least 12 characters")
	}

	return cfg, nil
}

func env(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func envBool(key string, fallback bool) bool {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func envInt(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func envDuration(key string, fallback time.Duration) time.Duration {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(value)
	if err != nil {
		return fallback
	}
	return parsed
}
