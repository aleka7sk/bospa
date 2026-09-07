package bospa

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type scanner interface{ Scan(dest ...any) error }

const applicationColumns = `
 a.id::text,a.workspace_id::text,a.external_id,a.apartment_id::text,
 a.guest_name,a.phone,a.source,a.status,a.check_in_at,a.check_out_at,
 a.total_amount_tiyn,a.required_prepayment_tiyn,a.paid_amount_tiyn,a.deposit_amount_tiyn,
 a.claimed_by::text,a.credited_manager_id::text,a.is_test,a.needs_alternative,
 a.pinned_note,a.lock_version,a.created_at,a.updated_at`

var applicationReturningColumns = strings.ReplaceAll(applicationColumns, "a.", "")

func scanApplication(row scanner) (Application, error) {
	var app Application
	err := row.Scan(
		&app.ID, &app.WorkspaceID, &app.ExternalID, &app.ApartmentID,
		&app.GuestName, &app.Phone, &app.Source, &app.Status, &app.CheckInAt, &app.CheckOutAt,
		&app.TotalAmountTiyn, &app.RequiredPrepaymentTiyn, &app.PaidAmountTiyn, &app.DepositAmountTiyn,
		&app.ClaimedBy, &app.CreditedManagerID, &app.IsTest, &app.NeedsAlternative,
		&app.PinnedNote, &app.LockVersion, &app.CreatedAt, &app.UpdatedAt,
	)
	return app, err
}

func (s *Store) ListApartments(ctx context.Context, workspaceID string) ([]Apartment, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id::text,workspace_id::text,code,address,unit,city,district,complex,
		       rooms,capacity,check_in_time::text,check_out_time::text,
		       weekday_rate_tiyn,weekend_rate_tiyn,active,catalog_enabled,published,
		       lock_version,created_at,updated_at
		FROM apartments WHERE workspace_id=$1 AND deleted_at IS NULL
		ORDER BY active DESC,complex,address,unit`, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("list apartments: %w", err)
	}
	defer rows.Close()
	items := make([]Apartment, 0)
	for rows.Next() {
		var item Apartment
		if err := rows.Scan(&item.ID, &item.WorkspaceID, &item.Code, &item.Address, &item.Unit, &item.City,
			&item.District, &item.Complex, &item.Rooms, &item.Capacity, &item.CheckInTime, &item.CheckOutTime,
			&item.WeekdayRateTiyn, &item.WeekendRateTiyn, &item.Active, &item.CatalogEnabled, &item.Published,
			&item.LockVersion, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan apartment: %w", err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) CreateApartment(ctx context.Context, principal Principal, input CreateApartmentInput) (Apartment, error) {
	if err := input.Validate(); err != nil {
		return Apartment{}, err
	}
	if input.City == "" {
		input.City = "Астана"
	}
	if input.CheckInTime == "" {
		input.CheckInTime = "14:00"
	}
	if input.CheckOutTime == "" {
		input.CheckOutTime = "12:00"
	}
	var item Apartment
	err := s.pool.QueryRow(ctx, `
		INSERT INTO apartments(workspace_id,code,address,unit,city,district,complex,rooms,capacity,
		 check_in_time,check_out_time,weekday_rate_tiyn,weekend_rate_tiyn,catalog_enabled,published)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::time,$11::time,$12,$13,$14,$15)
		RETURNING id::text,workspace_id::text,code,address,unit,city,district,complex,rooms,capacity,
		 check_in_time::text,check_out_time::text,weekday_rate_tiyn,weekend_rate_tiyn,active,catalog_enabled,
		 published,lock_version,created_at,updated_at`,
		principal.WorkspaceID, strings.TrimSpace(input.Code), strings.TrimSpace(input.Address), strings.TrimSpace(input.Unit),
		strings.TrimSpace(input.City), strings.TrimSpace(input.District), strings.TrimSpace(input.Complex), input.Rooms,
		input.Capacity, input.CheckInTime, input.CheckOutTime, input.WeekdayRateTiyn, input.WeekendRateTiyn,
		input.CatalogEnabled, input.Published,
	).Scan(&item.ID, &item.WorkspaceID, &item.Code, &item.Address, &item.Unit, &item.City, &item.District,
		&item.Complex, &item.Rooms, &item.Capacity, &item.CheckInTime, &item.CheckOutTime, &item.WeekdayRateTiyn,
		&item.WeekendRateTiyn, &item.Active, &item.CatalogEnabled, &item.Published, &item.LockVersion,
		&item.CreatedAt, &item.UpdatedAt)
	if err != nil {
		return Apartment{}, mapDBError(fmt.Errorf("create apartment: %w", err))
	}
	_ = s.audit(ctx, principal.WorkspaceID, principal.ID, "apartment.created", "apartment", item.ID, map[string]any{"code": item.Code})
	return item, nil
}

func (s *Store) ListApplications(ctx context.Context, workspaceID string, filter ApplicationFilter) ([]Application, error) {
	if filter.Limit <= 0 || filter.Limit > 500 {
		filter.Limit = 250
	}
	if filter.Offset < 0 {
		filter.Offset = 0
	}
	args := []any{workspaceID}
	where := []string{"a.workspace_id=$1", "a.deleted_at IS NULL"}
	add := func(format string, value any) {
		args = append(args, value)
		where = append(where, fmt.Sprintf(format, len(args)))
	}
	if filter.From != nil {
		add("a.check_out_at>$%d", *filter.From)
	}
	if filter.To != nil {
		add("a.check_in_at<$%d", *filter.To)
	}
	if filter.Status != "" {
		add("a.status=$%d", filter.Status)
	}
	if filter.Source != "" {
		add("a.source=$%d", filter.Source)
	}
	if filter.ManagerID != "" {
		add("a.claimed_by=$%d", filter.ManagerID)
	}
	args = append(args, filter.Limit, filter.Offset)
	query := `SELECT ` + applicationColumns + ` FROM applications a WHERE ` + strings.Join(where, " AND ") +
		fmt.Sprintf(` ORDER BY a.check_in_at,a.updated_at DESC LIMIT $%d OFFSET $%d`, len(args)-1, len(args))
	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list applications: %w", err)
	}
	defer rows.Close()
	items := make([]Application, 0)
	for rows.Next() {
		item, err := scanApplication(rows)
		if err != nil {
			return nil, fmt.Errorf("scan application: %w", err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) GetApplication(ctx context.Context, workspaceID, id string) (Application, error) {
	item, err := scanApplication(s.pool.QueryRow(ctx, `SELECT `+applicationColumns+` FROM applications a WHERE a.workspace_id=$1 AND a.id=$2 AND a.deleted_at IS NULL`, workspaceID, id))
	if err != nil {
		return Application{}, mapDBError(fmt.Errorf("get application: %w", err))
	}
	return item, nil
}

func (s *Store) GetApplicationDetail(ctx context.Context, workspaceID, id string) (ApplicationDetail, error) {
	app, err := s.GetApplication(ctx, workspaceID, id)
	if err != nil {
		return ApplicationDetail{}, err
	}
	result := ApplicationDetail{Application: app, Payments: []Payment{}, Comments: []Comment{}, Events: []Event{}}
	rows, err := s.pool.Query(ctx, `SELECT id::text,application_id::text,amount_tiyn,kind,method,status,note,received_at,created_at,created_by::text FROM payments WHERE workspace_id=$1 AND application_id=$2 ORDER BY received_at DESC,created_at DESC`, workspaceID, id)
	if err != nil {
		return ApplicationDetail{}, fmt.Errorf("list payments: %w", err)
	}
	for rows.Next() {
		var item Payment
		if err := rows.Scan(&item.ID, &item.ApplicationID, &item.AmountTiyn, &item.Kind, &item.Method, &item.Status, &item.Note, &item.ReceivedAt, &item.CreatedAt, &item.CreatedBy); err != nil {
			rows.Close()
			return ApplicationDetail{}, err
		}
		result.Payments = append(result.Payments, item)
	}
	rows.Close()
	rows, err = s.pool.Query(ctx, `SELECT c.id::text,c.application_id::text,c.author_id::text,u.short_name,c.body,c.created_at FROM comments c JOIN users u ON u.id=c.author_id WHERE c.workspace_id=$1 AND c.application_id=$2 AND c.deleted_at IS NULL ORDER BY c.created_at DESC`, workspaceID, id)
	if err != nil {
		return ApplicationDetail{}, fmt.Errorf("list comments: %w", err)
	}
	for rows.Next() {
		var item Comment
		if err := rows.Scan(&item.ID, &item.ApplicationID, &item.AuthorID, &item.AuthorName, &item.Text, &item.CreatedAt); err != nil {
			rows.Close()
			return ApplicationDetail{}, err
		}
		result.Comments = append(result.Comments, item)
	}
	rows.Close()
	rows, err = s.pool.Query(ctx, `SELECT id,application_id::text,event_type,text,actor_id::text,actor_name,metadata,created_at FROM application_events WHERE workspace_id=$1 AND application_id=$2 ORDER BY created_at DESC,id DESC LIMIT 500`, workspaceID, id)
	if err != nil {
		return ApplicationDetail{}, fmt.Errorf("list events: %w", err)
	}
	for rows.Next() {
		var item Event
		var metadata []byte
		if err := rows.Scan(&item.ID, &item.ApplicationID, &item.Type, &item.Text, &item.ActorID, &item.ActorName, &metadata, &item.CreatedAt); err != nil {
			rows.Close()
			return ApplicationDetail{}, err
		}
		_ = json.Unmarshal(metadata, &item.Metadata)
		result.Events = append(result.Events, item)
	}
	rows.Close()
	return result, nil
}

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
		return Application{}, err
	}
	if !apartmentExists {
		return Application{}, fmt.Errorf("%w: apartment", ErrValidation)
	}
	var claim any = principal.ID
	if input.External {
		claim = nil
	}
	app, err := scanApplication(tx.QueryRow(ctx, `
		INSERT INTO applications(workspace_id,apartment_id,external_id,source,guest_name,phone,status,
		 check_in_at,check_out_at,total_amount_tiyn,required_prepayment_tiyn,deposit_amount_tiyn,
		 claimed_by,is_test,pinned_note,created_by)
		VALUES($1,$2,COALESCE(NULLIF($3,''),'MAN-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10))),
		 $4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
		RETURNING `+applicationReturningColumns,
		principal.WorkspaceID, input.ApartmentID, strings.TrimSpace(input.ExternalID), strings.TrimSpace(input.Source),
		strings.TrimSpace(input.GuestName), strings.TrimSpace(input.Phone), input.Status, input.CheckInAt.UTC(), input.CheckOutAt.UTC(),
		input.TotalAmountTiyn, input.RequiredPrepaymentTiyn, input.DepositAmountTiyn, claim, input.IsTest,
		strings.TrimSpace(input.PinnedNote), principal.ID))
	if err != nil {
		return Application{}, mapDBError(fmt.Errorf("insert application: %w", err))
	}
	text := "Ручная заявка создана и взята в работу"
	if input.External {
		text = "Внешняя заявка получена"
	}
	if input.IsTest {
		text = "Тестовая заявка создана"
	}
	if err := addEvent(ctx, tx, principal.WorkspaceID, app.ID, "created", text, principal.ID, principal.ShortName, map[string]any{"source": app.Source}); err != nil {
		return Application{}, err
	}
	if err := auditTx(ctx, tx, principal.WorkspaceID, principal.ID, "application.created", "application", app.ID, map[string]any{"source": app.Source, "isTest": app.IsTest}); err != nil {
		return Application{}, err
	}
	if err := recomputeAlternatives(ctx, tx, principal.WorkspaceID); err != nil {
		return Application{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Application{}, mapDBError(err)
	}
	return s.GetApplication(ctx, principal.WorkspaceID, app.ID)
}

func (s *Store) ClaimApplication(ctx context.Context, principal Principal, id string) (Application, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Application{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	app, err := scanApplication(tx.QueryRow(ctx, `UPDATE applications a SET claimed_by=$3,lock_version=lock_version+1 WHERE a.workspace_id=$1 AND a.id=$2 AND a.deleted_at IS NULL AND (a.claimed_by IS NULL OR a.claimed_by=$3) RETURNING `+applicationColumns, principal.WorkspaceID, id, principal.ID))
	if errors.Is(err, pgx.ErrNoRows) {
		var exists bool
		_ = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM applications WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL)`, principal.WorkspaceID, id).Scan(&exists)
		if exists {
			return Application{}, ErrAlreadyClaimed
		}
		return Application{}, ErrNotFound
	}
	if err != nil {
		return Application{}, err
	}
	if err := addEvent(ctx, tx, principal.WorkspaceID, id, "claim", principal.ShortName+" взял(а) заявку в работу", principal.ID, principal.ShortName, nil); err != nil {
		return Application{}, err
	}
	if err := auditTx(ctx, tx, principal.WorkspaceID, principal.ID, "application.claimed", "application", id, nil); err != nil {
		return Application{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Application{}, err
	}
	return app, nil
}

func (s *Store) UpdateApplication(ctx context.Context, principal Principal, id string, input UpdateApplicationInput) (Application, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Application{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	current, err := scanApplication(tx.QueryRow(ctx, `SELECT `+applicationColumns+` FROM applications a WHERE a.workspace_id=$1 AND a.id=$2 AND a.deleted_at IS NULL FOR UPDATE`, principal.WorkspaceID, id))
	if err != nil {
		return Application{}, mapDBError(err)
	}
	if current.ClaimedBy != nil && *current.ClaimedBy != principal.ID && principal.Role != RoleOwner && principal.Role != RoleSuperadmin {
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
			return Application{}, fmt.Errorf("%w: phone", ErrValidation)
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
		return Application{}, fmt.Errorf("%w: invalid stay interval", ErrValidation)
	}
	if input.TotalAmountTiyn != nil {
		if *input.TotalAmountTiyn < 0 {
			return Application{}, ErrValidation
		}
		next.TotalAmountTiyn = *input.TotalAmountTiyn
		changes["totalAmountTiyn"] = next.TotalAmountTiyn
	}
	if input.RequiredPrepaymentTiyn != nil {
		if *input.RequiredPrepaymentTiyn < 0 {
			return Application{}, ErrValidation
		}
		next.RequiredPrepaymentTiyn = *input.RequiredPrepaymentTiyn
		changes["requiredPrepaymentTiyn"] = next.RequiredPrepaymentTiyn
	}
	if input.DepositAmountTiyn != nil {
		if *input.DepositAmountTiyn < 0 {
			return Application{}, ErrValidation
		}
		next.DepositAmountTiyn = *input.DepositAmountTiyn
		changes["depositAmountTiyn"] = next.DepositAmountTiyn
	}
	if input.PinnedNote != nil {
		next.PinnedNote = strings.TrimSpace(*input.PinnedNote)
		if len(next.PinnedNote) > 2000 {
			return Application{}, ErrValidation
		}
		changes["pinnedNote"] = next.PinnedNote
	}
	if len(changes) == 0 {
		return current, nil
	}
	if input.ApartmentID != nil {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM apartments WHERE workspace_id=$1 AND id=$2 AND active AND deleted_at IS NULL)`, principal.WorkspaceID, next.ApartmentID).Scan(&exists); err != nil {
			return Application{}, err
		}
		if !exists {
			return Application{}, fmt.Errorf("%w: target apartment", ErrValidation)
		}
	}
	updated, err := scanApplication(tx.QueryRow(ctx, `UPDATE applications a SET apartment_id=$3,guest_name=$4,phone=$5,check_in_at=$6,check_out_at=$7,total_amount_tiyn=$8,required_prepayment_tiyn=$9,deposit_amount_tiyn=$10,pinned_note=$11,lock_version=lock_version+1 WHERE a.workspace_id=$1 AND a.id=$2 RETURNING `+applicationColumns,
		principal.WorkspaceID, id, next.ApartmentID, next.GuestName, next.Phone, next.CheckInAt, next.CheckOutAt, next.TotalAmountTiyn, next.RequiredPrepaymentTiyn, next.DepositAmountTiyn, next.PinnedNote))
	if err != nil {
		return Application{}, mapDBError(err)
	}
	if err := addEvent(ctx, tx, principal.WorkspaceID, id, "change", "Данные заявки обновлены", principal.ID, principal.ShortName, changes); err != nil {
		return Application{}, err
	}
	if err := auditTx(ctx, tx, principal.WorkspaceID, principal.ID, "application.updated", "application", id, changes); err != nil {
		return Application{}, err
	}
	if err := recomputeAlternatives(ctx, tx, principal.WorkspaceID); err != nil {
		return Application{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Application{}, mapDBError(err)
	}
	return updated, nil
}

func (s *Store) UpdateStatus(ctx context.Context, principal Principal, id string, status Status, expectedVersion int64) (Application, error) {
	if !status.Valid() || status == StatusDuplicate || status == StatusError {
		return Application{}, ErrInvalidTransition
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Application{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	current, err := scanApplication(tx.QueryRow(ctx, `SELECT `+applicationColumns+` FROM applications a WHERE a.workspace_id=$1 AND a.id=$2 AND a.deleted_at IS NULL FOR UPDATE`, principal.WorkspaceID, id))
	if err != nil {
		return Application{}, mapDBError(err)
	}
	if current.ClaimedBy != nil && *current.ClaimedBy != principal.ID && principal.Role != RoleOwner && principal.Role != RoleSuperadmin {
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
		return Application{}, fmt.Errorf("%w: checkout has not happened", ErrValidation)
	}
	credited := current.CreditedManagerID
	if credited == nil && (status == StatusPrepaid || status == StatusPaid) {
		credited = current.ClaimedBy
	}
	updated, err := scanApplication(tx.QueryRow(ctx, `UPDATE applications a SET status=$3,credited_manager_id=$4,lock_version=lock_version+1 WHERE a.workspace_id=$1 AND a.id=$2 RETURNING `+applicationColumns, principal.WorkspaceID, id, status, credited))
	if err != nil {
		return Application{}, mapDBError(err)
	}
	if err := addEvent(ctx, tx, principal.WorkspaceID, id, "status", fmt.Sprintf("Статус: %s → %s", current.Status, status), principal.ID, principal.ShortName, map[string]any{"from": current.Status, "to": status}); err != nil {
		return Application{}, err
	}
	if err := auditTx(ctx, tx, principal.WorkspaceID, principal.ID, "application.status_changed", "application", id, map[string]any{"from": current.Status, "to": status}); err != nil {
		return Application{}, err
	}
	if err := recomputeAlternatives(ctx, tx, principal.WorkspaceID); err != nil {
		return Application{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Application{}, mapDBError(err)
	}
	return updated, nil
}

func (s *Store) AddPayment(ctx context.Context, principal Principal, id string, input CreatePaymentInput) (Payment, Application, error) {
	if input.ReceivedAt.IsZero() {
		input.ReceivedAt = time.Now().UTC()
	}
	if err := input.Validate(); err != nil {
		return Payment{}, Application{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Payment{}, Application{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	app, err := scanApplication(tx.QueryRow(ctx, `SELECT `+applicationColumns+` FROM applications a WHERE a.workspace_id=$1 AND a.id=$2 AND a.deleted_at IS NULL FOR UPDATE`, principal.WorkspaceID, id))
	if err != nil {
		return Payment{}, Application{}, mapDBError(err)
	}
	if app.ClaimedBy != nil && *app.ClaimedBy != principal.ID && principal.Role != RoleOwner && principal.Role != RoleSuperadmin {
		return Payment{}, Application{}, ErrForbidden
	}
	var payment Payment
	if err := tx.QueryRow(ctx, `INSERT INTO payments(workspace_id,application_id,amount_tiyn,kind,method,status,note,received_at,created_by) VALUES($1,$2,$3,$4,$5,'confirmed',$6,$7,$8) RETURNING id::text,application_id::text,amount_tiyn,kind,method,status,note,received_at,created_at,created_by::text`, principal.WorkspaceID, id, input.AmountTiyn, input.Kind, strings.TrimSpace(input.Method), strings.TrimSpace(input.Note), input.ReceivedAt.UTC(), principal.ID).Scan(&payment.ID, &payment.ApplicationID, &payment.AmountTiyn, &payment.Kind, &payment.Method, &payment.Status, &payment.Note, &payment.ReceivedAt, &payment.CreatedAt, &payment.CreatedBy); err != nil {
		return Payment{}, Application{}, mapDBError(err)
	}
	var paid int64
	if err := tx.QueryRow(ctx, `SELECT COALESCE(sum(amount_tiyn),0) FROM payments WHERE workspace_id=$1 AND application_id=$2 AND kind IN ('rent','refund','adjustment') AND status='confirmed'`, principal.WorkspaceID, id).Scan(&paid); err != nil {
		return Payment{}, Application{}, err
	}
	app, err = scanApplication(tx.QueryRow(ctx, `UPDATE applications a SET paid_amount_tiyn=$3,lock_version=lock_version+1 WHERE a.workspace_id=$1 AND a.id=$2 RETURNING `+applicationColumns, principal.WorkspaceID, id, paid))
	if err != nil {
		return Payment{}, Application{}, err
	}
	if err := addEvent(ctx, tx, principal.WorkspaceID, id, "payment", fmt.Sprintf("Подтверждён платёж %.2f ₸ · %s", float64(input.AmountTiyn)/100, input.Method), principal.ID, principal.ShortName, map[string]any{"paymentId": payment.ID, "amountTiyn": payment.AmountTiyn}); err != nil {
		return Payment{}, Application{}, err
	}
	if err := auditTx(ctx, tx, principal.WorkspaceID, principal.ID, "payment.confirmed", "payment", payment.ID, map[string]any{"applicationId": id, "amountTiyn": payment.AmountTiyn, "kind": payment.Kind}); err != nil {
		return Payment{}, Application{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Payment{}, Application{}, err
	}
	return payment, app, nil
}

func (s *Store) AddRefund(ctx context.Context, principal Principal, id string, input CreateRefundInput) (Payment, Application, error) {
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
		return Payment{}, Application{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	app, err := scanApplication(tx.QueryRow(ctx, `SELECT `+applicationColumns+` FROM applications a WHERE a.workspace_id=$1 AND a.id=$2 AND a.deleted_at IS NULL FOR UPDATE`, principal.WorkspaceID, id))
	if err != nil {
		return Payment{}, Application{}, mapDBError(err)
	}
	if input.AmountTiyn > app.PaidAmountTiyn {
		return Payment{}, Application{}, fmt.Errorf("%w: refund exceeds confirmed payments", ErrValidation)
	}
	var payment Payment
	if err := tx.QueryRow(ctx, `INSERT INTO payments(workspace_id,application_id,amount_tiyn,kind,method,status,note,received_at,created_by) VALUES($1,$2,$3,'refund',$4,'confirmed',$5,$6,$7) RETURNING id::text,application_id::text,amount_tiyn,kind,method,status,note,received_at,created_at,created_by::text`, principal.WorkspaceID, id, -input.AmountTiyn, strings.TrimSpace(input.Method), strings.TrimSpace(input.Reason), input.ReceivedAt.UTC(), principal.ID).Scan(&payment.ID, &payment.ApplicationID, &payment.AmountTiyn, &payment.Kind, &payment.Method, &payment.Status, &payment.Note, &payment.ReceivedAt, &payment.CreatedAt, &payment.CreatedBy); err != nil {
		return Payment{}, Application{}, mapDBError(err)
	}
	var paid int64
	if err := tx.QueryRow(ctx, `SELECT COALESCE(sum(amount_tiyn),0) FROM payments WHERE workspace_id=$1 AND application_id=$2 AND kind IN ('rent','refund','adjustment') AND status='confirmed'`, principal.WorkspaceID, id).Scan(&paid); err != nil {
		return Payment{}, Application{}, err
	}
	app, err = scanApplication(tx.QueryRow(ctx, `UPDATE applications a SET paid_amount_tiyn=$3,lock_version=lock_version+1 WHERE a.workspace_id=$1 AND a.id=$2 RETURNING `+applicationColumns, principal.WorkspaceID, id, paid))
	if err != nil {
		return Payment{}, Application{}, err
	}
	if err := addEvent(ctx, tx, principal.WorkspaceID, id, "payment", fmt.Sprintf("Зафиксирован возврат %.2f ₸ · %s", float64(input.AmountTiyn)/100, input.Reason), principal.ID, principal.ShortName, map[string]any{"paymentId": payment.ID, "amountTiyn": -input.AmountTiyn}); err != nil {
		return Payment{}, Application{}, err
	}
	if err := auditTx(ctx, tx, principal.WorkspaceID, principal.ID, "refund.recorded", "payment", payment.ID, map[string]any{"applicationId": id, "amountTiyn": input.AmountTiyn}); err != nil {
		return Payment{}, Application{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Payment{}, Application{}, err
	}
	return payment, app, nil
}

func (s *Store) AddComment(ctx context.Context, principal Principal, id, text string) (Comment, error) {
	text = strings.TrimSpace(text)
	if text == "" || len(text) > 4000 {
		return Comment{}, fmt.Errorf("%w: invalid comment", ErrValidation)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Comment{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM applications WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL)`, principal.WorkspaceID, id).Scan(&exists); err != nil {
		return Comment{}, err
	}
	if !exists {
		return Comment{}, ErrNotFound
	}
	var item Comment
	if err := tx.QueryRow(ctx, `INSERT INTO comments(workspace_id,application_id,author_id,body) VALUES($1,$2,$3,$4) RETURNING id::text,application_id::text,author_id::text,$5,body,created_at`, principal.WorkspaceID, id, principal.ID, text, principal.ShortName).Scan(&item.ID, &item.ApplicationID, &item.AuthorID, &item.AuthorName, &item.Text, &item.CreatedAt); err != nil {
		return Comment{}, err
	}
	if err := addEvent(ctx, tx, principal.WorkspaceID, id, "comment", text, principal.ID, principal.ShortName, map[string]any{"commentId": item.ID}); err != nil {
		return Comment{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Comment{}, err
	}
	return item, nil
}

func (s *Store) Bootstrap(ctx context.Context, principal Principal, from, to time.Time) (Bootstrap, error) {
	apartments, err := s.ListApartments(ctx, principal.WorkspaceID)
	if err != nil {
		return Bootstrap{}, err
	}
	applications, err := s.ListApplications(ctx, principal.WorkspaceID, ApplicationFilter{From: &from, To: &to, Limit: 500})
	if err != nil {
		return Bootstrap{}, err
	}
	return Bootstrap{User: principal.User, Workspace: principal.Workspace, Apartments: apartments, Applications: applications, ServerTime: time.Now().UTC()}, nil
}

func addEvent(ctx context.Context, tx pgx.Tx, workspaceID, applicationID, eventType, text, actorID, actorName string, metadata map[string]any) error {
	if metadata == nil {
		metadata = map[string]any{}
	}
	encoded, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO application_events(workspace_id,application_id,event_type,text,actor_id,actor_name,metadata) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`, workspaceID, applicationID, eventType, text, nullable(actorID), actorName, encoded)
	return err
}

func recomputeAlternatives(ctx context.Context, tx pgx.Tx, workspaceID string) error {
	_, err := tx.Exec(ctx, `
		UPDATE applications soft SET needs_alternative=CASE
		 WHEN soft.is_test OR soft.deleted_at IS NOT NULL OR soft.status NOT IN ('new','no_answer','thinking','awaiting_prepayment') THEN false
		 ELSE EXISTS(
		  SELECT 1 FROM applications hard
		  WHERE hard.workspace_id=soft.workspace_id AND hard.apartment_id=soft.apartment_id AND hard.id<>soft.id
		    AND hard.is_test=false AND hard.deleted_at IS NULL AND hard.status IN ('prepaid','paid','technical')
		    AND tstzrange(hard.check_in_at,hard.check_out_at,'[)') && tstzrange(soft.check_in_at,soft.check_out_at,'[)')
		 ) END WHERE soft.workspace_id=$1`, workspaceID)
	return err
}

func (s *Store) audit(ctx context.Context, workspaceID, actorID, action, entityType, entityID string, metadata map[string]any) error {
	encoded, _ := json.Marshal(metadata)
	_, err := s.pool.Exec(ctx, `INSERT INTO audit_log(workspace_id,actor_id,action,entity_type,entity_id,metadata) VALUES($1,$2,$3,$4,$5,$6::jsonb)`, workspaceID, nullable(actorID), action, entityType, entityID, encoded)
	return err
}

func auditTx(ctx context.Context, tx pgx.Tx, workspaceID, actorID, action, entityType, entityID string, metadata map[string]any) error {
	if metadata == nil {
		metadata = map[string]any{}
	}
	encoded, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO audit_log(workspace_id,actor_id,action,entity_type,entity_id,metadata) VALUES($1,$2,$3,$4,$5,$6::jsonb)`, workspaceID, nullable(actorID), action, entityType, entityID, encoded)
	return err
}

func nullable(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}
