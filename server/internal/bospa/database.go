package bospa

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

type Store struct {
	pool *pgxpool.Pool
}

func OpenStore(ctx context.Context, cfg Config) (*Store, error) {
	poolCfg, err := pgxpool.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}
	poolCfg.MaxConns = cfg.DatabaseMaxConns
	poolCfg.MinConns = cfg.DatabaseMinConns
	poolCfg.MaxConnLifetime = cfg.DatabaseMaxConnLife
	poolCfg.MaxConnIdleTime = 5 * time.Minute
	poolCfg.HealthCheckPeriod = 30 * time.Second
	poolCfg.ConnConfig.RuntimeParams["application_name"] = "bospa-api"
	poolCfg.ConnConfig.RuntimeParams["timezone"] = "UTC"

	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		return nil, fmt.Errorf("open database pool: %w", err)
	}
	store := &Store{pool: pool}
	if err := store.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return store, nil
}

func (s *Store) Close() { s.pool.Close() }

func (s *Store) Ping(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if err := s.pool.Ping(ctx); err != nil {
		return fmt.Errorf("database ping: %w", err)
	}
	return nil
}

func (s *Store) Migrate(ctx context.Context) error {
	conn, err := s.pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("acquire migration connection: %w", err)
	}
	defer conn.Release()

	tx, err := conn.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin migration lock: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('bospa_schema_migrations'))`); err != nil {
		return fmt.Errorf("lock migrations: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS bospa_schema_migrations (
			name text PRIMARY KEY,
			applied_at timestamptz NOT NULL DEFAULT now()
		)`); err != nil {
		return fmt.Errorf("create migration table: %w", err)
	}

	entries, err := fs.ReadDir(migrationsFS, "migrations")
	if err != nil {
		return fmt.Errorf("read embedded migrations: %w", err)
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".sql") {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)

	for _, name := range names {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM bospa_schema_migrations WHERE name = $1)`, name).Scan(&exists); err != nil {
			return fmt.Errorf("check migration %s: %w", name, err)
		}
		if exists {
			continue
		}
		content, err := migrationsFS.ReadFile("migrations/" + name)
		if err != nil {
			return fmt.Errorf("read migration %s: %w", name, err)
		}
		if _, err := tx.Exec(ctx, string(content)); err != nil {
			return fmt.Errorf("apply migration %s: %w", name, err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO bospa_schema_migrations(name) VALUES ($1)`, name); err != nil {
			return fmt.Errorf("record migration %s: %w", name, err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit migrations: %w", err)
	}
	return nil
}

func (s *Store) EnsureBootstrapOwner(ctx context.Context, cfg Config) error {
	if cfg.BootstrapEmail == "" {
		return nil
	}
	var existing string
	err := s.pool.QueryRow(ctx, `SELECT id::text FROM users WHERE email = $1 AND active`, cfg.BootstrapEmail).Scan(&existing)
	if err == nil {
		return nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("check bootstrap owner: %w", err)
	}

	hash, err := HashPassword(cfg.BootstrapPassword)
	if err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin bootstrap: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var workspaceID, userID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO workspaces(name, city, timezone, status)
		VALUES ($1, 'Астана', 'Asia/Almaty', 'trial')
		RETURNING id::text`, cfg.BootstrapWorkspace).Scan(&workspaceID); err != nil {
		return fmt.Errorf("create bootstrap workspace: %w", err)
	}
	shortName := strings.Fields(cfg.BootstrapName)[0]
	if err := tx.QueryRow(ctx, `
		INSERT INTO users(workspace_id, email, password_hash, name, short_name, role)
		VALUES ($1, $2, $3, $4, $5, 'owner')
		RETURNING id::text`, workspaceID, cfg.BootstrapEmail, hash, cfg.BootstrapName, shortName).Scan(&userID); err != nil {
		return fmt.Errorf("create bootstrap owner: %w", err)
	}

	seed := []struct {
		code, address, unit, district, complex string
		weekday, weekend                       int64
	}{
		{"BAISANAT", "Нестеров 1", "7", "Есиль", "Нестеров", 2_600_000, 3_200_000},
		{"NOMAD", "Брянская 12", "45", "Сарыарка", "Nomad", 2_100_000, 2_600_000},
		{"TURAN", "Туран 55/2", "91", "Нура", "Turan", 3_400_000, 4_200_000},
	}
	for _, apartment := range seed {
		if _, err := tx.Exec(ctx, `
			INSERT INTO apartments(
				workspace_id, code, address, unit, city, district, complex,
				rooms, capacity, weekday_rate_tiyn, weekend_rate_tiyn, catalog_enabled
			) VALUES ($1,$2,$3,$4,'Астана',$5,$6,2,4,$7,$8,true)`,
			workspaceID, apartment.code, apartment.address, apartment.unit, apartment.district,
			apartment.complex, apartment.weekday, apartment.weekend); err != nil {
			return fmt.Errorf("seed bootstrap apartment: %w", err)
		}
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO audit_log(workspace_id, actor_id, action, entity_type, entity_id, metadata)
		VALUES ($1::uuid,$2::uuid,'workspace.bootstrap','workspace',$4::text,jsonb_build_object('email',$3::text))`,
		workspaceID, userID, cfg.BootstrapEmail, workspaceID); err != nil {
		return fmt.Errorf("audit bootstrap: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit bootstrap: %w", err)
	}
	return nil
}

func mapDatabaseError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23P01":
			return ErrHardConflict
		case "23505":
			return ErrConflict
		case "23503", "23514", "22001", "22P02":
			return fmt.Errorf("%w: %s", ErrValidation, pgErr.ConstraintName)
		}
	}
	return err
}
