package bospa

import (
	"log/slog"
	"net/http"
	"time"
)

const (
	sessionCookieName = "bospa_session"
	csrfCookieName    = "bospa_csrf"
	maxJSONBody       = 2 << 20
)

type contextKey string

const (
	principalContextKey contextKey = "principal"
	requestIDContextKey contextKey = "request_id"
)

type API struct {
	cfg               Config
	store             *Store
	logger            *slog.Logger
	loginLimiter      *fixedWindowLimiter
	dummyPasswordHash string
}

func NewAPI(cfg Config, store *Store, logger *slog.Logger) *API {
	dummy, _ := HashPassword("bospa-invalid-password-value")
	return &API{
		cfg:               cfg,
		store:             store,
		logger:            logger,
		loginLimiter:      newFixedWindowLimiter(10, 10*time.Minute),
		dummyPasswordHash: dummy,
	}
}

func (api *API) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/health/live", api.handleLive)
	mux.HandleFunc("GET /api/v1/health/ready", api.handleReady)
	mux.HandleFunc("POST /api/v1/auth/login", api.handleLogin)

	mux.Handle("POST /api/v1/auth/logout", api.auth(api.csrf(http.HandlerFunc(api.handleLogout))))
	mux.Handle("GET /api/v1/auth/session", api.auth(http.HandlerFunc(api.handleSession)))
	mux.Handle("GET /api/v1/bootstrap", api.auth(http.HandlerFunc(api.handleBootstrap)))
	mux.Handle("GET /api/v1/apartments", api.auth(http.HandlerFunc(api.handleListApartments)))
	mux.Handle("POST /api/v1/apartments", api.auth(api.csrf(api.requireRoles(RoleOwner, RoleSuperadmin)(http.HandlerFunc(api.handleCreateApartment)))))
	mux.Handle("GET /api/v1/applications", api.auth(http.HandlerFunc(api.handleListApplications)))
	mux.Handle("POST /api/v1/applications", api.auth(api.csrf(api.requireRoles(RoleOwner, RoleManager, RoleSuperadmin)(http.HandlerFunc(api.handleCreateApplication)))))
	mux.Handle("GET /api/v1/applications/{id}", api.auth(http.HandlerFunc(api.handleGetApplication)))
	mux.Handle("PATCH /api/v1/applications/{id}", api.auth(api.csrf(http.HandlerFunc(api.handleUpdateApplication))))
	mux.Handle("POST /api/v1/applications/{id}/claim", api.auth(api.csrf(http.HandlerFunc(api.handleClaimApplication))))
	mux.Handle("PATCH /api/v1/applications/{id}/status", api.auth(api.csrf(http.HandlerFunc(api.handleUpdateStatus))))
	mux.Handle("POST /api/v1/applications/{id}/comments", api.auth(api.csrf(http.HandlerFunc(api.handleAddComment))))
	mux.Handle("POST /api/v1/applications/{id}/contacts", api.auth(api.csrf(http.HandlerFunc(api.handleAddContact))))
	mux.Handle("POST /api/v1/applications/{id}/payments", api.auth(api.csrf(http.HandlerFunc(api.handleAddPayment))))
	mux.Handle("POST /api/v1/applications/{id}/refunds", api.auth(api.csrf(api.requireRoles(RoleOwner, RoleSuperadmin)(http.HandlerFunc(api.handleAddRefund)))))

	var handler http.Handler = mux
	handler = api.cors(handler)
	handler = api.securityHeaders(handler)
	handler = api.accessLog(handler)
	handler = api.recoverer(handler)
	handler = api.requestID(handler)
	return handler
}
