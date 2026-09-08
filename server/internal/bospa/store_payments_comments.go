package bospa

import (
	"context"
	"fmt"
	"strings"
	"time"
)

func (s *Store) AddPayment(ctx context.Context, principal Principal, applicationID string, input CreatePaymentInput) (Payment, Application, error) {
	if input.ReceivedAt.IsZero() {
		input.ReceivedAt = time.Now().UTC()
	}
	if err := input.Validate(); err != nil {
		return Payment{}, Application{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Payment{}, Application{}, fmt.Errorf("begin payment: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	application, err := scanApplication(tx.QueryRow(ctx, `
		SELECT `+applicationColumns+` FROM applications a
		WHERE a.workspace_id=$1 AND a.id=$2 AND a.deleted_at IS NULL FOR UPDATE`, principal.WorkspaceID, applicationID))
	if err != nil {
		return Payment{}, Application{}, mapDatabaseError(fmt.Errorf("load application for payment: %w", err))
	}
	if application.ClaimedBy != nil && *application.ClaimedBy != principal.ID && principal.Role != RoleOwner {
		return Payment{}, Application{}, ErrForbidden
	}
	var payment Payment
	if err := tx.QueryRow(ctx, `
		INSERT INTO payments(workspace_id, application_id, amount_tiyn, kind, method, status, note, received_at, created_by)
		VALUES ($1,$2,$3,$4,$5,'confirmed',$6,$7,$8)
		RETURNING id::text, application_id::text, amount_tiyn, kind, method, status, note, received_at, created_at, created_by::text`,
		principal.WorkspaceID, applicationID, input.AmountTiyn, input.Kind, strings.TrimSpace(input.Method), strings.TrimSpace(input.Note), input.ReceivedAt.UTC(), principal.ID,
	).Scan(&payment.ID, &payment.ApplicationID, &payment.AmountTiyn, &payment.Kind, &payment.Method, &payment.Status, &payment.Note, &payment.ReceivedAt, &payment.CreatedAt, &payment.CreatedBy); err != nil {
		return Payment{}, Application{}, mapDatabaseError(fmt.Errorf("insert payment: %w", err))
	}

	var paidAmount int64
	if err := tx.QueryRow(ctx, `
		SELECT COALESCE(sum(amount_tiyn),0)
		FROM payments
		WHERE workspace_id=$1 AND application_id=$2 AND kind IN ('rent','refund','adjustment') AND status='confirmed'`, principal.WorkspaceID, applicationID).Scan(&paidAmount); err != nil {
		return Payment{}, Application{}, fmt.Errorf("sum application payments: %w", err)
	}
	application, err = scanApplication(tx.QueryRow(ctx, `
		UPDATE applications a SET paid_amount_tiyn=$3, lock_version=lock_version+1
		WHERE a.workspace_id=$1 AND a.id=$2
		RETURNING `+applicationColumns, principal.WorkspaceID, applicationID, paidAmount))
	if err != nil {
		return Payment{}, Application{}, fmt.Errorf("update application paid amount: %w", err)
	}
	if err := insertApplicationEvent(ctx, tx, principal.WorkspaceID, applicationID, "payment", fmt.Sprintf("Подтверждён платёж %.2f ₸ · %s", float64(input.AmountTiyn)/100, input.Method), principal.ID, principal.ShortName, map[string]any{"paymentId": payment.ID, "amountTiyn": payment.AmountTiyn, "kind": payment.Kind}); err != nil {
		return Payment{}, Application{}, err
	}
	if err := auditTx(ctx, tx, principal.WorkspaceID, principal.ID, "payment.confirmed", "payment", payment.ID, map[string]any{"applicationId": applicationID, "amountTiyn": payment.AmountTiyn, "kind": payment.Kind}); err != nil {
		return Payment{}, Application{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Payment{}, Application{}, fmt.Errorf("commit payment: %w", err)
	}
	return payment, application, nil
}

func (s *Store) AddComment(ctx context.Context, principal Principal, applicationID, text string) (Comment, error) {
	text = strings.TrimSpace(text)
	if text == "" || len(text) > 4000 {
		return Comment{}, fmt.Errorf("%w: comment is empty or too long", ErrValidation)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Comment{}, fmt.Errorf("begin comment: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM applications WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL)`, principal.WorkspaceID, applicationID).Scan(&exists); err != nil {
		return Comment{}, fmt.Errorf("validate comment application: %w", err)
	}
	if !exists {
		return Comment{}, ErrNotFound
	}
	var comment Comment
	if err := tx.QueryRow(ctx, `
		INSERT INTO comments(workspace_id, application_id, author_id, body)
		VALUES ($1,$2,$3,$4)
		RETURNING id::text, application_id::text, author_id::text, $5, body, created_at`,
		principal.WorkspaceID, applicationID, principal.ID, text, principal.ShortName,
	).Scan(&comment.ID, &comment.ApplicationID, &comment.AuthorID, &comment.AuthorName, &comment.Text, &comment.CreatedAt); err != nil {
		return Comment{}, fmt.Errorf("insert comment: %w", err)
	}
	if err := insertApplicationEvent(ctx, tx, principal.WorkspaceID, applicationID, "comment", text, principal.ID, principal.ShortName, map[string]any{"commentId": comment.ID}); err != nil {
		return Comment{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Comment{}, fmt.Errorf("commit comment: %w", err)
	}
	return comment, nil
}
