package bospa

import (
	"context"
	"fmt"
	"strings"
)

func (s *Store) UpdateApplication(ctx context.Context, principal Principal, applicationID string, input UpdateApplicationInput) (Application, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Application{}, fmt.Errorf("begin application update: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	current, err := scanApplication(tx.QueryRow(ctx, `
		SELECT `+applicationColumns+` FROM applications a
		WHERE a.workspace_id=$1 AND a.id=$2 AND a.deleted_at IS NULL FOR UPDATE`, principal.WorkspaceID, applicationID))
	if err != nil {
		return Application{}, mapDatabaseError(fmt.Errorf("load application for update: %w", err))
	}
	if current.ClaimedBy != nil && *current.ClaimedBy != principal.ID && principal.Role != RoleOwner {
		return Application{}, ErrForbidden
	}
	if input.LockVersion > 0 && current.LockVersion != input.LockVersion {
		return Application{}, ErrConflict
	}

	next := current
	changes := map[string]any{}
	if input.GuestName != nil {
		next.GuestName = strings.TrimSpace(*input.GuestName)
		changes["guestName"] = next.GuestName
	}
	if input.Phone != nil {
		next.Phone = strings.TrimSpace(*input.Phone)
		if len(next.Phone) < 5 {
			return Application{}, fmt.Errorf("%w: phone is required", ErrValidation)
		}
		changes["phone"] = next.Phone
	}
	if input.ApartmentID != nil {
		next.ApartmentID = strings.TrimSpace(*input.ApartmentID)
		changes["apartmentId"] = next.ApartmentID
	}
	if input.CheckInAt != nil {
		next.CheckInAt = input.CheckInAt.UTC()
		changes["checkInAt"] = next.CheckInAt
	}
	if input.CheckOutAt != nil {
		next.CheckOutAt = input.CheckOutAt.UTC()
		changes["checkOutAt"] = next.CheckOutAt
	}
	if !next.CheckOutAt.After(next.CheckInAt) {
		return Application{}, fmt.Errorf("%w: checkOutAt must be after checkInAt", ErrValidation)
	}
	if input.TotalAmountTiyn != nil {
		if *input.TotalAmountTiyn < 0 {
			return Application{}, fmt.Errorf("%w: total cannot be negative", ErrValidation)
		}
		next.TotalAmountTiyn = *input.TotalAmountTiyn
		changes["totalAmountTiyn"] = next.TotalAmountTiyn
	}
	if input.RequiredPrepaymentTiyn != nil {
		if *input.RequiredPrepaymentTiyn < 0 {
			return Application{}, fmt.Errorf("%w: prepayment cannot be negative", ErrValidation)
		}
		next.RequiredPrepaymentTiyn = *input.RequiredPrepaymentTiyn
		changes["requiredPrepaymentTiyn"] = next.RequiredPrepaymentTiyn
	}
	if input.DepositAmountTiyn != nil {
		if *input.DepositAmountTiyn < 0 {
			return Application{}, fmt.Errorf("%w: deposit cannot be negative", ErrValidation)
		}
		next.DepositAmountTiyn = *input.DepositAmountTiyn
		changes["depositAmountTiyn"] = next.DepositAmountTiyn
	}
	if input.PinnedNote != nil {
		next.PinnedNote = strings.TrimSpace(*input.PinnedNote)
		if len(next.PinnedNote) > 2000 {
			return Application{}, fmt.Errorf("%w: pinned note is too long", ErrValidation)
		}
		changes["pinnedNote"] = next.PinnedNote
	}
	if len(changes) == 0 {
		return current, nil
	}

	if input.ApartmentID != nil {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM apartments WHERE workspace_id=$1 AND id=$2 AND active AND deleted_at IS NULL)`, principal.WorkspaceID, next.ApartmentID).Scan(&exists); err != nil {
			return Application{}, fmt.Errorf("validate target apartment: %w", err)
		}
		if !exists {
			return Application{}, fmt.Errorf("%w: target apartment", ErrValidation)
		}
	}

	updated, err := scanApplication(tx.QueryRow(ctx, `
		UPDATE applications a
		SET apartment_id=$3, guest_name=$4, phone=$5, check_in_at=$6, check_out_at=$7,
		    total_amount_tiyn=$8, required_prepayment_tiyn=$9, deposit_amount_tiyn=$10,
		    pinned_note=$11, lock_version=lock_version+1
		WHERE a.workspace_id=$1 AND a.id=$2
		RETURNING `+applicationColumns,
		principal.WorkspaceID, applicationID, next.ApartmentID, next.GuestName, next.Phone,
		next.CheckInAt, next.CheckOutAt, next.TotalAmountTiyn, next.RequiredPrepaymentTiyn,
		next.DepositAmountTiyn, next.PinnedNote))
	if err != nil {
		return Application{}, mapDatabaseError(fmt.Errorf("update application: %w", err))
	}
	if err := insertApplicationEvent(ctx, tx, principal.WorkspaceID, applicationID, "change", "Данные заявки обновлены", principal.ID, principal.ShortName, changes); err != nil {
		return Application{}, err
	}
	if err := auditTx(ctx, tx, principal.WorkspaceID, principal.ID, "application.updated", "application", applicationID, changes); err != nil {
		return Application{}, err
	}
	if err := recomputeAlternatives(ctx, tx, principal.WorkspaceID); err != nil {
		return Application{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Application{}, mapDatabaseError(fmt.Errorf("commit application update: %w", err))
	}
	return updated, nil
}
