package bospa

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

func (s *Store) AddContactEvent(ctx context.Context, principal Principal, applicationID string, input CreateContactInput) (ApplicationEvent, error) {
	if err := input.Validate(); err != nil {
		return ApplicationEvent{}, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ApplicationEvent{}, fmt.Errorf("begin contact event: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var exists bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM applications
			WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL
		)`, principal.WorkspaceID, applicationID).Scan(&exists); err != nil {
		return ApplicationEvent{}, fmt.Errorf("validate contact application: %w", err)
	}
	if !exists {
		return ApplicationEvent{}, ErrNotFound
	}

	note := strings.TrimSpace(input.Note)
	text := input.Outcome.Label()
	if note != "" {
		text += ": " + note
	}
	metadata := map[string]any{"outcome": input.Outcome}
	if input.CallbackAt != nil {
		callback := input.CallbackAt.UTC()
		metadata["callbackAt"] = callback
		text += " · перезвонить " + callback.Format(time.RFC3339)
	}
	encoded, err := json.Marshal(metadata)
	if err != nil {
		return ApplicationEvent{}, fmt.Errorf("encode contact metadata: %w", err)
	}

	var event ApplicationEvent
	var metadataBytes []byte
	var actorID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO application_events(
			workspace_id, application_id, event_type, text, actor_id, actor_name, metadata
		) VALUES ($1,$2,'contact',$3,$4,$5,$6::jsonb)
		RETURNING id, application_id::text, event_type, text, actor_id::text, actor_name, metadata, created_at`,
		principal.WorkspaceID,
		applicationID,
		text,
		principal.ID,
		principal.ShortName,
		encoded,
	).Scan(
		&event.ID,
		&event.ApplicationID,
		&event.Type,
		&event.Text,
		&actorID,
		&event.ActorName,
		&metadataBytes,
		&event.CreatedAt,
	); err != nil {
		return ApplicationEvent{}, fmt.Errorf("insert contact event: %w", err)
	}
	event.ActorID = &actorID
	_ = json.Unmarshal(metadataBytes, &event.Metadata)

	if _, err := tx.Exec(ctx, `UPDATE applications SET updated_at=now() WHERE workspace_id=$1 AND id=$2`, principal.WorkspaceID, applicationID); err != nil {
		return ApplicationEvent{}, fmt.Errorf("touch contacted application: %w", err)
	}
	if err := auditTx(ctx, tx, principal.WorkspaceID, principal.ID, "application.contact_recorded", "application", applicationID, metadata); err != nil {
		return ApplicationEvent{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ApplicationEvent{}, fmt.Errorf("commit contact event: %w", err)
	}
	return event, nil
}
