package bospa

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

func (s *Store) ListApplications(ctx context.Context, workspaceID string, filter ListApplicationsFilter) ([]Application, error) {
	if filter.Limit <= 0 || filter.Limit > 500 {
		filter.Limit = 250
	}
	if filter.Offset < 0 {
		filter.Offset = 0
	}

	args := []any{workspaceID}
	where := []string{"a.workspace_id = $1", "a.deleted_at IS NULL"}
	add := func(condition string, value any) {
		args = append(args, value)
		where = append(where, fmt.Sprintf(condition, len(args)))
	}
	if filter.From != nil {
		add("a.check_out_at > $%d", *filter.From)
	}
	if filter.To != nil {
		add("a.check_in_at < $%d", *filter.To)
	}
	if filter.Status != "" {
		add("a.status = $%d", filter.Status)
	}
	if filter.Source != "" {
		add("a.source = $%d", filter.Source)
	}
	if filter.ManagerID != "" {
		add("a.claimed_by = $%d", filter.ManagerID)
	}
	args = append(args, filter.Limit, filter.Offset)
	query := `SELECT ` + applicationColumns + ` FROM applications a WHERE ` + strings.Join(where, " AND ") +
		fmt.Sprintf(` ORDER BY a.check_in_at, a.updated_at DESC LIMIT $%d OFFSET $%d`, len(args)-1, len(args))

	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list applications: %w", err)
	}
	defer rows.Close()
	applications := make([]Application, 0)
	for rows.Next() {
		application, err := scanApplication(rows)
		if err != nil {
			return nil, fmt.Errorf("scan application: %w", err)
		}
		applications = append(applications, application)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate applications: %w", err)
	}
	return applications, nil
}

func (s *Store) GetApplication(ctx context.Context, workspaceID, applicationID string) (Application, error) {
	application, err := scanApplication(s.pool.QueryRow(ctx, `
		SELECT `+applicationColumns+`
		FROM applications a
		WHERE a.workspace_id = $1 AND a.id = $2 AND a.deleted_at IS NULL`, workspaceID, applicationID))
	if err != nil {
		return Application{}, mapDatabaseError(fmt.Errorf("get application: %w", err))
	}
	return application, nil
}

func (s *Store) GetApplicationDetail(ctx context.Context, workspaceID, applicationID string) (ApplicationDetail, error) {
	application, err := s.GetApplication(ctx, workspaceID, applicationID)
	if err != nil {
		return ApplicationDetail{}, err
	}
	detail := ApplicationDetail{Application: application, Payments: []Payment{}, Comments: []Comment{}, Events: []ApplicationEvent{}}

	paymentRows, err := s.pool.Query(ctx, `
		SELECT id::text, application_id::text, amount_tiyn, kind, method, status, note, received_at, created_at, created_by::text
		FROM payments WHERE workspace_id = $1 AND application_id = $2 ORDER BY received_at DESC, created_at DESC`, workspaceID, applicationID)
	if err != nil {
		return ApplicationDetail{}, fmt.Errorf("list payments: %w", err)
	}
	for paymentRows.Next() {
		var payment Payment
		if err := paymentRows.Scan(&payment.ID, &payment.ApplicationID, &payment.AmountTiyn, &payment.Kind, &payment.Method, &payment.Status, &payment.Note, &payment.ReceivedAt, &payment.CreatedAt, &payment.CreatedBy); err != nil {
			paymentRows.Close()
			return ApplicationDetail{}, fmt.Errorf("scan payment: %w", err)
		}
		detail.Payments = append(detail.Payments, payment)
	}
	paymentRows.Close()

	commentRows, err := s.pool.Query(ctx, `
		SELECT c.id::text, c.application_id::text, c.author_id::text, u.short_name, c.body, c.created_at
		FROM comments c JOIN users u ON u.id = c.author_id
		WHERE c.workspace_id = $1 AND c.application_id = $2 AND c.deleted_at IS NULL
		ORDER BY c.created_at DESC`, workspaceID, applicationID)
	if err != nil {
		return ApplicationDetail{}, fmt.Errorf("list comments: %w", err)
	}
	for commentRows.Next() {
		var comment Comment
		if err := commentRows.Scan(&comment.ID, &comment.ApplicationID, &comment.AuthorID, &comment.AuthorName, &comment.Text, &comment.CreatedAt); err != nil {
			commentRows.Close()
			return ApplicationDetail{}, fmt.Errorf("scan comment: %w", err)
		}
		detail.Comments = append(detail.Comments, comment)
	}
	commentRows.Close()

	eventRows, err := s.pool.Query(ctx, `
		SELECT id, application_id::text, event_type, text, actor_id::text, actor_name, metadata, created_at
		FROM application_events
		WHERE workspace_id = $1 AND application_id = $2
		ORDER BY created_at DESC, id DESC LIMIT 500`, workspaceID, applicationID)
	if err != nil {
		return ApplicationDetail{}, fmt.Errorf("list application events: %w", err)
	}
	for eventRows.Next() {
		var event ApplicationEvent
		var metadata []byte
		if err := eventRows.Scan(&event.ID, &event.ApplicationID, &event.Type, &event.Text, &event.ActorID, &event.ActorName, &metadata, &event.CreatedAt); err != nil {
			eventRows.Close()
			return ApplicationDetail{}, fmt.Errorf("scan application event: %w", err)
		}
		_ = json.Unmarshal(metadata, &event.Metadata)
		detail.Events = append(detail.Events, event)
	}
	eventRows.Close()
	return detail, nil
}
