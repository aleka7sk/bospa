package bospa

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

type Role string

const (
	RoleOwner      Role = "owner"
	RoleManager    Role = "manager"
	RoleSuperadmin Role = "superadmin"
)

type Status string

const (
	StatusNew              Status = "new"
	StatusNoAnswer         Status = "no_answer"
	StatusThinking         Status = "thinking"
	StatusAwaitingPrepay   Status = "awaiting_prepayment"
	StatusPrepaid          Status = "prepaid"
	StatusPaid             Status = "paid"
	StatusCompleted        Status = "completed"
	StatusDeclined         Status = "declined"
	StatusUnpaid           Status = "unpaid"
	StatusCancelledClient  Status = "cancelled_client"
	StatusCancelledCompany Status = "cancelled_company"
	StatusDuplicate        Status = "duplicate"
	StatusError            Status = "error"
	StatusTechnical        Status = "technical"
)

var (
	ErrNotFound          = errors.New("not found")
	ErrUnauthorized      = errors.New("unauthorized")
	ErrForbidden         = errors.New("forbidden")
	ErrConflict          = errors.New("conflict")
	ErrHardConflict      = errors.New("hard booking conflict")
	ErrAlreadyClaimed    = errors.New("already claimed")
	ErrValidation        = errors.New("validation error")
	ErrInvalidTransition = errors.New("invalid status transition")
)

var allowedTransitions = map[Status]map[Status]bool{
	StatusNew: {
		StatusNoAnswer: true, StatusThinking: true, StatusAwaitingPrepay: true,
		StatusDeclined: true, StatusCancelledClient: true, StatusCancelledCompany: true,
	},
	StatusNoAnswer: {
		StatusNew: true, StatusThinking: true, StatusAwaitingPrepay: true,
		StatusDeclined: true, StatusCancelledClient: true, StatusCancelledCompany: true,
	},
	StatusThinking: {
		StatusNew: true, StatusNoAnswer: true, StatusAwaitingPrepay: true,
		StatusDeclined: true, StatusCancelledClient: true, StatusCancelledCompany: true,
	},
	StatusAwaitingPrepay: {
		StatusNoAnswer: true, StatusThinking: true, StatusPrepaid: true, StatusPaid: true,
		StatusUnpaid: true, StatusDeclined: true, StatusCancelledClient: true, StatusCancelledCompany: true,
	},
	StatusPrepaid: {
		StatusPaid: true, StatusCancelledClient: true, StatusCancelledCompany: true,
	},
	StatusPaid: {
		StatusCompleted: true, StatusCancelledClient: true, StatusCancelledCompany: true,
	},
	StatusTechnical: {StatusCancelledCompany: true},
}

func (s Status) Valid() bool {
	switch s {
	case StatusNew, StatusNoAnswer, StatusThinking, StatusAwaitingPrepay, StatusPrepaid,
		StatusPaid, StatusCompleted, StatusDeclined, StatusUnpaid, StatusCancelledClient,
		StatusCancelledCompany, StatusDuplicate, StatusError, StatusTechnical:
		return true
	default:
		return false
	}
}

func (s Status) Hard() bool {
	return s == StatusPrepaid || s == StatusPaid || s == StatusTechnical
}

func ValidateTransition(from, to Status) error {
	if !from.Valid() || !to.Valid() || to == StatusDuplicate || to == StatusError {
		return fmt.Errorf("%w: %s -> %s", ErrInvalidTransition, from, to)
	}
	if from == to || allowedTransitions[from][to] {
		return nil
	}
	return fmt.Errorf("%w: %s -> %s", ErrInvalidTransition, from, to)
}

type Workspace struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	City     string `json:"city"`
	Timezone string `json:"timezone"`
	Status   string `json:"status"`
}

type User struct {
	ID          string    `json:"id"`
	WorkspaceID string    `json:"workspaceId"`
	Email       string    `json:"email"`
	Name        string    `json:"name"`
	ShortName   string    `json:"shortName"`
	Role        Role      `json:"role"`
	Active      bool      `json:"active"`
	CreatedAt   time.Time `json:"createdAt"`
}

type Principal struct {
	User
	Workspace Workspace `json:"workspace"`
	SessionID string    `json:"sessionId"`
	CSRFHash  []byte    `json:"-"`
	ExpiresAt time.Time `json:"expiresAt"`
}

type Apartment struct {
	ID              string    `json:"id"`
	WorkspaceID     string    `json:"workspaceId"`
	Code            string    `json:"code"`
	Address         string    `json:"address"`
	Unit            string    `json:"unit"`
	City            string    `json:"city"`
	District        string    `json:"district"`
	Complex         string    `json:"complex"`
	Rooms           int       `json:"rooms"`
	Capacity        int       `json:"capacity"`
	CheckInTime     string    `json:"checkInTime"`
	CheckOutTime    string    `json:"checkOutTime"`
	WeekdayRateTiyn int64     `json:"weekdayRateTiyn"`
	WeekendRateTiyn int64     `json:"weekendRateTiyn"`
	Active          bool      `json:"active"`
	CatalogEnabled  bool      `json:"catalogEnabled"`
	Published       bool      `json:"published"`
	LockVersion     int64     `json:"lockVersion"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

type Application struct {
	ID                     string    `json:"id"`
	WorkspaceID            string    `json:"workspaceId"`
	ExternalID             string    `json:"externalId"`
	ApartmentID            string    `json:"apartmentId"`
	GuestName              string    `json:"guestName"`
	Phone                  string    `json:"phone"`
	Source                 string    `json:"source"`
	Status                 Status    `json:"status"`
	CheckInAt              time.Time `json:"checkInAt"`
	CheckOutAt             time.Time `json:"checkOutAt"`
	TotalAmountTiyn        int64     `json:"totalAmountTiyn"`
	RequiredPrepaymentTiyn int64     `json:"requiredPrepaymentTiyn"`
	PaidAmountTiyn         int64     `json:"paidAmountTiyn"`
	DepositAmountTiyn      int64     `json:"depositAmountTiyn"`
	ClaimedBy              *string   `json:"claimedBy"`
	CreditedManagerID      *string   `json:"creditedManagerId"`
	IsTest                 bool      `json:"isTest"`
	NeedsAlternative       bool      `json:"needsAlternative"`
	PinnedNote             string    `json:"pinnedNote"`
	LockVersion            int64     `json:"lockVersion"`
	CreatedAt              time.Time `json:"createdAt"`
	UpdatedAt              time.Time `json:"updatedAt"`
}

type Payment struct {
	ID            string    `json:"id"`
	ApplicationID string    `json:"applicationId"`
	AmountTiyn    int64     `json:"amountTiyn"`
	Kind          string    `json:"kind"`
	Method        string    `json:"method"`
	Status        string    `json:"status"`
	Note          string    `json:"note"`
	ReceivedAt    time.Time `json:"receivedAt"`
	CreatedAt     time.Time `json:"createdAt"`
	CreatedBy     string    `json:"createdBy"`
}

type Comment struct {
	ID            string    `json:"id"`
	ApplicationID string    `json:"applicationId"`
	AuthorID      string    `json:"authorId"`
	AuthorName    string    `json:"authorName"`
	Text          string    `json:"text"`
	CreatedAt     time.Time `json:"createdAt"`
}

type Event struct {
	ID            int64          `json:"id"`
	ApplicationID string         `json:"applicationId"`
	Type          string         `json:"type"`
	Text          string         `json:"text"`
	ActorID       *string        `json:"actorId"`
	ActorName     string         `json:"actorName"`
	Metadata      map[string]any `json:"metadata"`
	CreatedAt     time.Time      `json:"createdAt"`
}

type ApplicationDetail struct {
	Application Application `json:"application"`
	Payments    []Payment   `json:"payments"`
	Comments    []Comment   `json:"comments"`
	Events      []Event     `json:"events"`
}

type Bootstrap struct {
	User         User          `json:"user"`
	Workspace    Workspace     `json:"workspace"`
	Apartments   []Apartment   `json:"apartments"`
	Applications []Application `json:"applications"`
	ServerTime   time.Time     `json:"serverTime"`
}

type CreateApartmentInput struct {
	Code            string `json:"code"`
	Address         string `json:"address"`
	Unit            string `json:"unit"`
	City            string `json:"city"`
	District        string `json:"district"`
	Complex         string `json:"complex"`
	Rooms           int    `json:"rooms"`
	Capacity        int    `json:"capacity"`
	CheckInTime     string `json:"checkInTime"`
	CheckOutTime    string `json:"checkOutTime"`
	WeekdayRateTiyn int64  `json:"weekdayRateTiyn"`
	WeekendRateTiyn int64  `json:"weekendRateTiyn"`
	CatalogEnabled  bool   `json:"catalogEnabled"`
	Published       bool   `json:"published"`
}

func (in CreateApartmentInput) Validate() error {
	if strings.TrimSpace(in.Code) == "" || strings.TrimSpace(in.Address) == "" || strings.TrimSpace(in.Unit) == "" {
		return fmt.Errorf("%w: code, address and unit are required", ErrValidation)
	}
	if in.Capacity < 1 || in.Rooms < 0 || in.WeekdayRateTiyn < 0 || in.WeekendRateTiyn < 0 {
		return fmt.Errorf("%w: apartment values are invalid", ErrValidation)
	}
	return nil
}

type CreateApplicationInput struct {
	ApartmentID            string    `json:"apartmentId"`
	GuestName              string    `json:"guestName"`
	Phone                  string    `json:"phone"`
	Source                 string    `json:"source"`
	Status                 Status    `json:"status"`
	CheckInAt              time.Time `json:"checkInAt"`
	CheckOutAt             time.Time `json:"checkOutAt"`
	TotalAmountTiyn        int64     `json:"totalAmountTiyn"`
	RequiredPrepaymentTiyn int64     `json:"requiredPrepaymentTiyn"`
	DepositAmountTiyn      int64     `json:"depositAmountTiyn"`
	PinnedNote             string    `json:"pinnedNote"`
	IsTest                 bool      `json:"isTest"`
	ExternalID             string    `json:"externalId"`
	External               bool      `json:"external"`
}

func (in CreateApplicationInput) Validate() error {
	if strings.TrimSpace(in.ApartmentID) == "" || strings.TrimSpace(in.Phone) == "" {
		return fmt.Errorf("%w: apartmentId and phone are required", ErrValidation)
	}
	if !in.CheckOutAt.After(in.CheckInAt) {
		return fmt.Errorf("%w: checkout must be after checkin", ErrValidation)
	}
	if !in.Status.Valid() || in.Status == StatusDuplicate || in.Status == StatusError {
		return fmt.Errorf("%w: status is invalid", ErrValidation)
	}
	if in.TotalAmountTiyn < 0 || in.RequiredPrepaymentTiyn < 0 || in.DepositAmountTiyn < 0 {
		return fmt.Errorf("%w: amount cannot be negative", ErrValidation)
	}
	return nil
}

type UpdateApplicationInput struct {
	GuestName              *string    `json:"guestName"`
	Phone                  *string    `json:"phone"`
	ApartmentID            *string    `json:"apartmentId"`
	CheckInAt              *time.Time `json:"checkInAt"`
	CheckOutAt             *time.Time `json:"checkOutAt"`
	TotalAmountTiyn        *int64     `json:"totalAmountTiyn"`
	RequiredPrepaymentTiyn *int64     `json:"requiredPrepaymentTiyn"`
	DepositAmountTiyn      *int64     `json:"depositAmountTiyn"`
	PinnedNote             *string    `json:"pinnedNote"`
	LockVersion            int64      `json:"lockVersion"`
}

type ApplicationFilter struct {
	From      *time.Time
	To        *time.Time
	Status    Status
	Source    string
	ManagerID string
	Limit     int
	Offset    int
}

type CreatePaymentInput struct {
	AmountTiyn int64     `json:"amountTiyn"`
	Kind       string    `json:"kind"`
	Method     string    `json:"method"`
	Note       string    `json:"note"`
	ReceivedAt time.Time `json:"receivedAt"`
}

func (in CreatePaymentInput) Validate() error {
	if in.AmountTiyn <= 0 || (in.Kind != "rent" && in.Kind != "deposit") || strings.TrimSpace(in.Method) == "" {
		return fmt.Errorf("%w: invalid payment", ErrValidation)
	}
	return nil
}

type CreateRefundInput struct {
	AmountTiyn int64     `json:"amountTiyn"`
	Method     string    `json:"method"`
	Reason     string    `json:"reason"`
	ReceivedAt time.Time `json:"receivedAt"`
}

func (in CreateRefundInput) Validate() error {
	if in.AmountTiyn <= 0 || strings.TrimSpace(in.Method) == "" || strings.TrimSpace(in.Reason) == "" {
		return fmt.Errorf("%w: invalid refund", ErrValidation)
	}
	return nil
}
