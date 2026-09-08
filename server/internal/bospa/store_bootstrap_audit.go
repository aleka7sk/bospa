package bospa

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5"
	"strings"
	"time"
)

func (s *Store) Bootstrap(ctx context.Context, principal Principal, from, to time.Time) (Bootstrap, error) {
	users, err := s.ListUsers(ctx, principal.WorkspaceID)
	if err != nil {
		return Bootstrap{}, err
	}
	apartments, err := s.ListApartments(ctx, principal.WorkspaceID)
	if err != nil {
		return Bootstrap{}, err
	}
	applications, err := s.ListApplications(ctx, principal.WorkspaceID, ListApplicationsFilter{From: &from, To: &to, Limit: 500})
	if err != nil {
		return Bootstrap{}, err
	}
	return Bootstrap{
		User:         principal.User,
		Workspace:    principal.Workspace,
		Users:        users,
		Apartments:   apartments,
		Applications: applications,
		ServerTime:   time.Now().UTC(),
	}, nil
}

func insertApplicationEvent(ctx context.Context, tx pgx.Tx, workspaceID, applicationID, eventType, text, actorID, actorName string, metadata map[string]any) error {
	if metadata == nil {
		metadata = map[string]any{}
	}
	encoded, err := json.Marshal(metadata)
	if err != nil {
		return fmt.Errorf("encode event metadata: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO application_events(workspace_id, application_id, event_type, text, actor_id, actor_name, metadata)
		VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`, workspaceID, applicationID, eventType, text, nullableString(actorID), actorName, encoded); err != nil {
		return fmt.Errorf("insert application event: %w", err)
	}
	return nil
}

func recomputeAlternatives(ctx context.Context, tx pgx.Tx, workspaceID string) error {
	_, err := tx.Exec(ctx, `
		UPDATE applications soft
		SET needs_alternative = CASE
			WHEN soft.is_test OR soft.deleted_at IS NOT NULL OR soft.status NOT IN ('new','no_answer','thinking','awaiting_prepayment') THEN false
			ELSE EXISTS (
				SELECT 1 FROM applications hard
				WHERE hard.workspace_id = soft.workspace_id
				  AND hard.apartment_id = soft.apartment_id
				  AND hard.id <> soft.id
				  AND hard.is_test = false
				  AND hard.deleted_at IS NULL
				  AND hard.status IN ('prepaid','paid','technical')
				  AND tstzrange(hard.check_in_at, hard.check_out_at, '[)') && tstzrange(soft.check_in_at, soft.check_out_at, '[)')
			)
		END
		WHERE soft.workspace_id = $1`, workspaceID)
	if err != nil {
		return fmt.Errorf("recompute alternatives: %w", err)
	}
	return nil
}

func (s *Store) audit(ctx context.Context, workspaceID, actorID, action, entityType, entityID string, metadata map[string]any) error {
	encoded, _ := json.Marshal(metadata)
	_, err := s.pool.Exec(ctx, `
		INSERT INTO audit_log(workspace_id, actor_id, action, entity_type, entity_id, metadata)
		VALUES ($1,$2,$3,$4,$5,$6::jsonb)`, workspaceID, nullableString(actorID), action, entityType, entityID, encoded)
	return err
}

func auditTx(ctx context.Context, tx pgx.Tx, workspaceID, actorID, action, entityType, entityID string, metadata map[string]any) error {
	if metadata == nil {
		metadata = map[string]any{}
	}
	encoded, err := json.Marshal(metadata)
	if err != nil {
		return fmt.Errorf("encode audit metadata: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO audit_log(workspace_id, actor_id, action, entity_type, entity_id, metadata)
		VALUES ($1,$2,$3,$4,$5,$6::jsonb)`, workspaceID, nullableString(actorID), action, entityType, entityID, encoded); err != nil {
		return fmt.Errorf("insert audit entry: %w", err)
	}
	return nil
}

func nullableString(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}
