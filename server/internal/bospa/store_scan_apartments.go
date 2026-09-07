package bospa

import (
	"context"
	"fmt"
	"strings"
)

type scanner interface {
	Scan(dest ...any) error
}

const applicationColumns = `
	a.id::text, a.workspace_id::text, a.external_id, a.apartment_id::text,
	a.guest_name, a.phone, a.source, a.status, a.check_in_at, a.check_out_at,
	a.total_amount_tiyn, a.required_prepayment_tiyn, a.paid_amount_tiyn, a.deposit_amount_tiyn,
	a.claimed_by::text, a.credited_manager_id::text, a.is_test, a.needs_alternative,
	a.pinned_note, a.lock_version, a.created_at, a.updated_at`

var applicationReturningColumns = strings.ReplaceAll(applicationColumns, "a.", "")

func scanApplication(row scanner) (Application, error) {
	var application Application
	err := row.Scan(
		&application.ID, &application.WorkspaceID, &application.ExternalID, &application.ApartmentID,
		&application.GuestName, &application.Phone, &application.Source, &application.Status,
		&application.CheckInAt, &application.CheckOutAt, &application.TotalAmountTiyn,
		&application.RequiredPrepaymentTiyn, &application.PaidAmountTiyn, &application.DepositAmountTiyn,
		&application.ClaimedBy, &application.CreditedManagerID, &application.IsTest,
		&application.NeedsAlternative, &application.PinnedNote, &application.LockVersion,
		&application.CreatedAt, &application.UpdatedAt,
	)
	return application, err
}

func (s *Store) ListApartments(ctx context.Context, workspaceID string) ([]Apartment, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id::text, workspace_id::text, code, address, unit, city, district, complex,
		       rooms, capacity, check_in_time::text, check_out_time::text,
		       weekday_rate_tiyn, weekend_rate_tiyn, active, catalog_enabled, published,
		       lock_version, created_at, updated_at
		FROM apartments
		WHERE workspace_id = $1 AND deleted_at IS NULL
		ORDER BY active DESC, complex, address, unit`, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("list apartments: %w", err)
	}
	defer rows.Close()

	apartments := make([]Apartment, 0)
	for rows.Next() {
		var apartment Apartment
		if err := rows.Scan(
			&apartment.ID, &apartment.WorkspaceID, &apartment.Code, &apartment.Address,
			&apartment.Unit, &apartment.City, &apartment.District, &apartment.Complex,
			&apartment.Rooms, &apartment.Capacity, &apartment.CheckInTime, &apartment.CheckOutTime,
			&apartment.WeekdayRateTiyn, &apartment.WeekendRateTiyn, &apartment.Active,
			&apartment.CatalogEnabled, &apartment.Published, &apartment.LockVersion,
			&apartment.CreatedAt, &apartment.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan apartment: %w", err)
		}
		apartments = append(apartments, apartment)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate apartments: %w", err)
	}
	return apartments, nil
}

func (s *Store) CreateApartment(ctx context.Context, workspaceID, actorID string, input CreateApartmentInput) (Apartment, error) {
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

	var apartment Apartment
	err := s.pool.QueryRow(ctx, `
		INSERT INTO apartments(
			workspace_id, code, address, unit, city, district, complex, rooms, capacity,
			check_in_time, check_out_time, weekday_rate_tiyn, weekend_rate_tiyn,
			catalog_enabled, published
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::time,$11::time,$12,$13,$14,$15)
		RETURNING id::text, workspace_id::text, code, address, unit, city, district, complex,
		          rooms, capacity, check_in_time::text, check_out_time::text,
		          weekday_rate_tiyn, weekend_rate_tiyn, active, catalog_enabled, published,
		          lock_version, created_at, updated_at`,
		workspaceID, strings.TrimSpace(input.Code), strings.TrimSpace(input.Address), strings.TrimSpace(input.Unit),
		strings.TrimSpace(input.City), strings.TrimSpace(input.District), strings.TrimSpace(input.Complex),
		input.Rooms, input.Capacity, input.CheckInTime, input.CheckOutTime,
		input.WeekdayRateTiyn, input.WeekendRateTiyn, input.CatalogEnabled, input.Published,
	).Scan(
		&apartment.ID, &apartment.WorkspaceID, &apartment.Code, &apartment.Address,
		&apartment.Unit, &apartment.City, &apartment.District, &apartment.Complex,
		&apartment.Rooms, &apartment.Capacity, &apartment.CheckInTime, &apartment.CheckOutTime,
		&apartment.WeekdayRateTiyn, &apartment.WeekendRateTiyn, &apartment.Active,
		&apartment.CatalogEnabled, &apartment.Published, &apartment.LockVersion,
		&apartment.CreatedAt, &apartment.UpdatedAt,
	)
	if err != nil {
		return Apartment{}, mapDatabaseError(fmt.Errorf("create apartment: %w", err))
	}
	_ = s.audit(ctx, workspaceID, actorID, "apartment.created", "apartment", apartment.ID, map[string]any{"code": apartment.Code})
	return apartment, nil
}
