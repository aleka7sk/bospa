package bospa

import (
	"context"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"strings"
	"time"
)

func (s *Store) CreateApplication(ctx context.Context, principal Principal, input CreateApplicationInput) (Application, error) {
	if input.Status == "" {
		input.Status = StatusNew
	}
	if input.Source == "" {
		input.Source = "Ручная"
	}
	if err := input.Validate(); err != nil {
		return Application{}, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Application{}, fmt.Errorf("begin create application: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var apartmentExists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM apartments WHERE id=$1 AND workspace_id=$2 AND active AND deleted_at IS NULL)`, input.ApartmentID, principal.WorkspaceID).Scan(&apartmentExists); err != nil {
		return Application{}, fmt.Errorf("validate apartment: %w", err)
	}
	if !apartmentExists {
		return Application{}, fmt.Errorf("%w: apartment", ErrValidation)
	}

	claimedBy := any(principal.ID)
	if input.External {
		claimedBy = nil
	}
	application, err := scanApplication(tx.QueryRow(ctx, `
		INSERT INTO applications(
			workspace_id, apartment_id, external_id, source, guest_name, phone, status,
			check_in_at, check_out_at, total_amount_tiyn, required_prepayment_tiyn,
			deposit_amount_tiyn, claimed_by, is_test, pinned_note, created_by
		) VALUES (
			$1,$2,COALESCE(NULLIF($3,''),'MAN-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10))),
			$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
		)
		RETURNING `+applicationReturningColumns,
		principal.WorkspaceID, input.ApartmentID, strings.TrimSpace(input.ExternalID), strings.TrimSpace(input.Source),
		strings.TrimSpace(input.GuestName), strings.TrimSpace(input.Phone), input.Status,
		input.CheckInAt.UTC(), input.CheckOutAt.UTC(), input.TotalAmountTiyn,
		input.RequiredPrepaymentTiyn, input.DepositAmountTiyn, claimedBy, input.IsTest,
		strings.TrimSpace(input.PinnedNote), principal.ID,
	))
	if err != nil {
		return Application{}, mapDatabaseError(fmt.Errorf("insert application: %w", err))
	}

	text := "Ручная заявка создана и взята в работу"
	if input.External {
		text = "Внешняя заявка получена"
	}
	if input.IsTest {
		text = "Тестовая заявка создана"
	}
	if err := insertApplicationEvent(ctx, tx, principal.WorkspaceID, application.ID, "created", text, principal.ID, principal.ShortName, map[string]any{"source": application.Source}); err != nil {
		return Application{}, err
	}
	if err := auditTx(ctx, tx, principal.WorkspaceID, principal.ID, "application.created", "application", application.ID, map[string]any{"source": application.Source, "isTest": application.IsTest}); err != nil {
		return Application{}, err
	}
	if err := recomputeAlternatives(ctx, tx, principal.WorkspaceID); err != nil {
		return Application{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Application{}, mapDatabaseError(fmt.Errorf("commit application: %w", err))
	}
	return s.GetApplication(ctx, principal.WorkspaceID, application.ID)
}

func (s *Store) ClaimApplication(ctx context.Context, principal Principal, applicationID string) (Application, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Application{}, fmt.Errorf("begin claim: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	application, err := scanApplication(tx.QueryRow(ctx, `
		UPDATE applications a
		SET claimed_by = $3, lock_version = lock_version + 1
		WHERE a.workspace_id = $1 AND a.id = $2 AND a.deleted_at IS NULL
		  AND (a.claimed_by IS NULL OR a.claimed_by = $3)
		RETURNING `+applicationColumns, principal.WorkspaceID, applicationID, principal.ID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			var exists bool
			_ = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM applications WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL)`, principal.WorkspaceID, applicationID).Scan(&exists)
			if exists {
				return Application{}, ErrAlreadyClaimed
			}
			return Application{}, ErrNotFound
		}
		return Application{}, fmt.Errorf("claim application: %w", err)
	}
	if err := insertApplicationEvent(ctx, tx, principal.WorkspaceID, application.ID, "claim", principal.ShortName+" взял(а) заявку в работу", principal.ID, principal.ShortName, nil); err != nil {
		return Application{}, err
	}
	if err := auditTx(ctx, tx, principal.WorkspaceID, principal.ID, "application.claimed", "application", application.ID, nil); err != nil {
		return Application{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Application{}, fmt.Errorf("commit claim: %w", err)
	}
	return application, nil
}

func (s *Store) UpdateApplicationStatus(ctx context.Context, principal Principal, applicationID string, status ApplicationStatus, expectedVersion int64) (Application, error) {
	if !status.Valid() || status == StatusDuplicate || status == StatusError {
		return Application{}, ErrInvalidStatus
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Application{}, fmt.Errorf("begin status update: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	current, err := scanApplication(tx.QueryRow(ctx, `
		SELECT `+applicationColumns+`
		FROM applications a
		WHERE a.workspace_id=$1 AND a.id=$2 AND a.deleted_at IS NULL
		FOR UPDATE`, principal.WorkspaceID, applicationID))
	if err != nil {
		return Application{}, mapDatabaseError(fmt.Errorf("load application for status: %w", err))
	}
	if current.ClaimedBy != nil && *current.ClaimedBy != principal.ID && principal.Role != RoleOwner {
		return Application{}, ErrForbidden
	}
	if expectedVersion > 0 && current.LockVersion != expectedVersion {
		return Application{}, ErrConflict
	}
	if err := ValidateTransition(current.Status, status); err != nil {
		return Application{}, err
	}
	if status == StatusPrepaid && current.PaidAmountTiyn < current.RequiredPrepaymentTiyn {
		return Application{}, fmt.Errorf("%w: required prepayment is not confirmed", ErrValidation)
	}
	if (status == StatusPaid || status == StatusCompleted) && current.PaidAmountTiyn < current.TotalAmountTiyn {
		return Application{}, fmt.Errorf("%w: full payment is not confirmed", ErrValidation)
	}
	if status == StatusCompleted && time.Now().UTC().Before(current.CheckOutAt) {
		return Application{}, fmt.Errorf("%w: checkout has not happened yet", ErrValidation)
	}

	credited := current.CreditedManagerID
	if credited == nil && (status == StatusPrepaid || status == StatusPaid) {
		credited = current.ClaimedBy
	}
	updated, err := scanApplication(tx.QueryRow(ctx, `
		UPDATE applications a
		SET status=$3, credited_manager_id=$4, lock_version=lock_version+1
		WHERE a.workspace_id=$1 AND a.id=$2
		RETURNING `+applicationColumns, principal.WorkspaceID, applicationID, status, credited))
	if err != nil {
		return Application{}, mapDatabaseError(fmt.Errorf("update application status: %w", err))
	}
	if err := insertApplicationEvent(ctx, tx, principal.WorkspaceID, applicationID, "status", fmt.Sprintf("Статус: %s → %s", current.Status, status), principal.ID, principal.ShortName, map[string]any{"from": current.Status, "to": status}); err != nil {
		return Application{}, err
	}
	if err := auditTx(ctx, tx, principal.WorkspaceID, principal.ID, "application.status_changed", "application", applicationID, map[string]any{"from": current.Status, "to": status}); err != nil {
		return Application{}, err
	}
	if err := recomputeAlternatives(ctx, tx, principal.WorkspaceID); err != nil {
		return Application{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Application{}, mapDatabaseError(fmt.Errorf("commit status update: %w", err))
	}
	return updated, nil
}
