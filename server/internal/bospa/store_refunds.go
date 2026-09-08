package bospa

import (
	"context"
	"fmt"
	"strings"
	"time"
)

func (s *Store) AddRefund(ctx context.Context, principal Principal, applicationID string, input CreateRefundInput) (Payment, Application, error) {
	if principal.Role != RoleOwner && principal.Role != RoleSuperadmin {
		return Payment{}, Application{}, ErrForbidden
	}
	if input.ReceivedAt.IsZero() {
		input.ReceivedAt = time.Now().UTC()
	}
	if err := input.Validate(); err != nil {
		return Payment{}, Application{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Payment{}, Application{}, fmt.Errorf("begin refund: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	application, err := scanApplication(tx.QueryRow(ctx, `
		SELECT `+applicationColumns+` FROM applications a
		WHERE a.workspace_id=$1 AND a.id=$2 AND a.deleted_at IS NULL FOR UPDATE`, principal.WorkspaceID, applicationID))
	if err != nil {
		return Payment{}, Application{}, mapDatabaseError(fmt.Errorf("load application for refund: %w", err))
	}
	if input.AmountTiyn > application.PaidAmountTiyn {
		return Payment{}, Application{}, fmt.Errorf("%w: refund exceeds confirmed rent payments", ErrValidation)
	}

	var payment Payment
	if err := tx.QueryRow(ctx, `
		INSERT INTO payments(workspace_id, application_id, amount_tiyn, kind, method, status, note, received_at, created_by)
		VALUES ($1,$2,$3,'refund',$4,'confirmed',$5,$6,$7)
		RETURNING id::text, application_id::text, amount_tiyn, kind, method, status, note, received_at, created_at, created_by::text`,
		principal.WorkspaceID, applicationID, -input.AmountTiyn, strings.TrimSpace(input.Method), strings.TrimSpace(input.Reason), input.ReceivedAt.UTC(), principal.ID,
	).Scan(&payment.ID, &payment.ApplicationID, &payment.AmountTiyn, &payment.Kind, &payment.Method, &payment.Status, &payment.Note, &payment.ReceivedAt, &payment.CreatedAt, &payment.CreatedBy); err != nil {
		return Payment{}, Application{}, mapDatabaseError(fmt.Errorf("insert refund: %w", err))
	}
	var paidAmount int64
	if err := tx.QueryRow(ctx, `
		SELECT COALESCE(sum(amount_tiyn),0) FROM payments
		WHERE workspace_id=$1 AND application_id=$2 AND kind IN ('rent','refund','adjustment') AND status='confirmed'`, principal.WorkspaceID, applicationID).Scan(&paidAmount); err != nil {
		return Payment{}, Application{}, fmt.Errorf("sum after refund: %w", err)
	}
	application, err = scanApplication(tx.QueryRow(ctx, `
		UPDATE applications a SET paid_amount_tiyn=$3, lock_version=lock_version+1
		WHERE a.workspace_id=$1 AND a.id=$2 RETURNING `+applicationColumns,
		principal.WorkspaceID, applicationID, paidAmount))
	if err != nil {
		return Payment{}, Application{}, fmt.Errorf("update application after refund: %w", err)
	}
	if err := insertApplicationEvent(ctx, tx, principal.WorkspaceID, applicationID, "payment", fmt.Sprintf("Зафиксирован возврат %.2f ₸ · %s", float64(input.AmountTiyn)/100, input.Reason), principal.ID, principal.ShortName, map[string]any{"paymentId": payment.ID, "amountTiyn": -input.AmountTiyn}); err != nil {
		return Payment{}, Application{}, err
	}
	if err := auditTx(ctx, tx, principal.WorkspaceID, principal.ID, "refund.recorded", "payment", payment.ID, map[string]any{"applicationId": applicationID, "amountTiyn": input.AmountTiyn, "reason": input.Reason}); err != nil {
		return Payment{}, Application{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Payment{}, Application{}, fmt.Errorf("commit refund: %w", err)
	}
	return payment, application, nil
}
