package bospa

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type loginRecord struct {
	User
	PasswordHash string
}

func (s *Store) UserForLogin(ctx context.Context, email string) (loginRecord, error) {
	var record loginRecord
	err := s.pool.QueryRow(ctx, `
		SELECT id::text, workspace_id::text, email::text, name, short_name, role, active, created_at, password_hash
		FROM users
		WHERE email = $1 AND active
		LIMIT 1`, strings.TrimSpace(strings.ToLower(email))).Scan(
		&record.ID, &record.WorkspaceID, &record.Email, &record.Name, &record.ShortName,
		&record.Role, &record.Active, &record.CreatedAt, &record.PasswordHash,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return loginRecord{}, ErrUnauthorized
		}
		return loginRecord{}, fmt.Errorf("find login user: %w", err)
	}
	return record, nil
}

func (s *Store) CreateSession(
	ctx context.Context,
	userID string,
	tokenHash, csrfHash []byte,
	expiresAt time.Time,
	userAgent string,
	ip net.IP,
) (string, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("begin create session: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if _, err := tx.Exec(ctx, `UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, userID); err != nil {
		return "", fmt.Errorf("revoke previous sessions: %w", err)
	}
	var sessionID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO sessions(user_id, token_hash, csrf_hash, expires_at, user_agent, ip)
		VALUES ($1,$2,$3,$4,$5,$6)
		RETURNING id::text`, userID, tokenHash, csrfHash, expiresAt, userAgent, nullableIP(ip)).Scan(&sessionID); err != nil {
		return "", fmt.Errorf("insert session: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit session: %w", err)
	}
	return sessionID, nil
}

func (s *Store) PrincipalByToken(ctx context.Context, tokenHash []byte) (Principal, error) {
	var principal Principal
	err := s.pool.QueryRow(ctx, `
		SELECT
			u.id::text, u.workspace_id::text, u.email::text, u.name, u.short_name, u.role, u.active, u.created_at,
			w.id::text, w.name, w.city, w.timezone, w.status,
			s.id::text, s.csrf_hash, s.expires_at
		FROM sessions s
		JOIN users u ON u.id = s.user_id
		JOIN workspaces w ON w.id = u.workspace_id
		WHERE s.token_hash = $1
		  AND s.revoked_at IS NULL
		  AND s.expires_at > now()
		  AND u.active
		  AND w.status <> 'closed'`, tokenHash).Scan(
		&principal.ID, &principal.WorkspaceID, &principal.Email, &principal.Name, &principal.ShortName,
		&principal.Role, &principal.Active, &principal.CreatedAt,
		&principal.Workspace.ID, &principal.Workspace.Name, &principal.Workspace.City,
		&principal.Workspace.Timezone, &principal.Workspace.Status,
		&principal.SessionID, &principal.CSRFHash, &principal.ExpiresAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Principal{}, ErrUnauthorized
		}
		return Principal{}, fmt.Errorf("load session principal: %w", err)
	}
	_, _ = s.pool.Exec(ctx, `UPDATE sessions SET last_seen_at = now() WHERE id = $1 AND last_seen_at < now() - interval '5 minutes'`, principal.SessionID)
	return principal, nil
}

func (s *Store) RevokeSession(ctx context.Context, sessionID string) error {
	command, err := s.pool.Exec(ctx, `UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, sessionID)
	if err != nil {
		return fmt.Errorf("revoke session: %w", err)
	}
	if command.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) DeleteExpiredSessions(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM sessions WHERE expires_at < now() - interval '7 days' OR revoked_at < now() - interval '7 days'`)
	if err != nil {
		return fmt.Errorf("delete expired sessions: %w", err)
	}
	return nil
}

func nullableIP(ip net.IP) any {
	if len(ip) == 0 {
		return nil
	}
	return ip.String()
}
