package bospa

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

type contextKey string

const (
	principalKey contextKey = "principal"
	requestIDKey contextKey = "request-id"
)

const (
	sessionCookie = "bospa_session"
	csrfCookie    = "bospa_csrf"
)

type API struct {
	cfg     Config
	store   *Store
	logger  *slog.Logger
	limiter *loginLimiter
	handler http.Handler
}

type loginLimiter struct {
	mu      sync.Mutex
	entries map[string]loginWindow
}

type loginWindow struct {
	Count int
	Reset time.Time
}

func NewAPI(cfg Config, store *Store, logger *slog.Logger) *API {
	api := &API{cfg: cfg, store: store, logger: logger, limiter: &loginLimiter{entries: map[string]loginWindow{}}}
	api.handler = api.routes()
	return api
}

func (a *API) ServeHTTP(w http.ResponseWriter, r *http.Request) { a.handler.ServeHTTP(w, r) }

func (a *API) routes() http.Handler {
	public := http.NewServeMux()
	public.HandleFunc("GET /api/v1/health/live", a.handleLive)
	public.HandleFunc("GET /api/v1/health/ready", a.handleReady)
	public.HandleFunc("POST /api/v1/auth/login", a.handleLogin)

	protected := http.NewServeMux()
	protected.HandleFunc("GET /api/v1/auth/session", a.handleSession)
	protected.HandleFunc("POST /api/v1/auth/logout", a.handleLogout)
	protected.HandleFunc("GET /api/v1/bootstrap", a.handleBootstrap)
	protected.HandleFunc("GET /api/v1/apartments", a.handleListApartments)
	protected.HandleFunc("POST /api/v1/apartments", a.handleCreateApartment)
	protected.HandleFunc("GET /api/v1/applications", a.handleListApplications)
	protected.HandleFunc("POST /api/v1/applications", a.handleCreateApplication)
	protected.HandleFunc("GET /api/v1/applications/{id}", a.handleGetApplication)
	protected.HandleFunc("PATCH /api/v1/applications/{id}", a.handleUpdateApplication)
	protected.HandleFunc("POST /api/v1/applications/{id}/claim", a.handleClaimApplication)
	protected.HandleFunc("POST /api/v1/applications/{id}/status", a.handleUpdateStatus)
	protected.HandleFunc("POST /api/v1/applications/{id}/comments", a.handleAddComment)
	protected.HandleFunc("POST /api/v1/applications/{id}/payments", a.handleAddPayment)
	protected.HandleFunc("POST /api/v1/applications/{id}/refunds", a.handleAddRefund)

	root := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, pattern := public.Handler(r); pattern != "" {
			public.ServeHTTP(w, r)
			return
		}
		a.requireAuth(a.requireCSRF(protected)).ServeHTTP(w, r)
	})
	return a.recoverer(a.requestContext(a.securityHeaders(a.cors(a.accessLog(root)))))
}

func (a *API) handleLive(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "service": "bospa-api"})
}

func (a *API) handleReady(w http.ResponseWriter, r *http.Request) {
	if err := a.store.Ping(r.Context()); err != nil {
		writeError(w, r, http.StatusServiceUnavailable, "database_unavailable", "Database is not ready", nil)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ready"})
}

var dummyPasswordHash, _ = HashPassword("invalid-password-never-used")

func (a *API) handleLogin(w http.ResponseWriter, r *http.Request) {
	if !a.limiter.allow(clientIP(r)) {
		writeError(w, r, http.StatusTooManyRequests, "rate_limited", "Too many login attempts", nil)
		return
	}
	var input struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	record, err := a.store.UserForLogin(r.Context(), input.Email)
	if err != nil {
		_ = VerifyPassword(dummyPasswordHash, input.Password)
		writeError(w, r, http.StatusUnauthorized, "invalid_credentials", "Invalid email or password", nil)
		return
	}
	if !VerifyPassword(record.PasswordHash, input.Password) {
		writeError(w, r, http.StatusUnauthorized, "invalid_credentials", "Invalid email or password", nil)
		return
	}
	token, tokenHash, err := NewSecret()
	if err != nil {
		a.internalError(w, r, err)
		return
	}
	csrf, csrfHash, err := NewSecret()
	if err != nil {
		a.internalError(w, r, err)
		return
	}
	expires := time.Now().UTC().Add(a.cfg.SessionTTL)
	if _, err := a.store.CreateSession(r.Context(), record.ID, tokenHash, csrfHash, expires, truncate(r.UserAgent(), 500), net.ParseIP(clientIP(r))); err != nil {
		a.internalError(w, r, err)
		return
	}
	a.setSessionCookies(w, token, csrf, expires)
	principal, err := a.store.PrincipalByToken(r.Context(), tokenHash)
	if err != nil {
		a.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": principal.User, "workspace": principal.Workspace, "csrfToken": csrf, "expiresAt": expires})
}

func (a *API) handleSession(w http.ResponseWriter, r *http.Request) {
	p := principalFromContext(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{"user": p.User, "workspace": p.Workspace, "expiresAt": p.ExpiresAt})
}

func (a *API) handleLogout(w http.ResponseWriter, r *http.Request) {
	p := principalFromContext(r.Context())
	if err := a.store.RevokeSession(r.Context(), p.SessionID); err != nil && !errors.Is(err, ErrNotFound) {
		a.internalError(w, r, err)
		return
	}
	a.clearSessionCookies(w)
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) handleBootstrap(w http.ResponseWriter, r *http.Request) {
	p := principalFromContext(r.Context())
	from := time.Now().UTC().AddDate(0, 0, -35)
	to := time.Now().UTC().AddDate(0, 0, 120)
	if value := r.URL.Query().Get("from"); value != "" {
		if parsed, err := time.Parse(time.RFC3339, value); err == nil {
			from = parsed
		}
	}
	if value := r.URL.Query().Get("to"); value != "" {
		if parsed, err := time.Parse(time.RFC3339, value); err == nil {
			to = parsed
		}
	}
	if to.Sub(from) > 550*24*time.Hour {
		to = from.Add(550 * 24 * time.Hour)
	}
	result, err := a.store.Bootstrap(r.Context(), p, from, to)
	if err != nil {
		a.handleStoreError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (a *API) handleListApartments(w http.ResponseWriter, r *http.Request) {
	p := principalFromContext(r.Context())
	items, err := a.store.ListApartments(r.Context(), p.WorkspaceID)
	if err != nil {
		a.handleStoreError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (a *API) handleCreateApartment(w http.ResponseWriter, r *http.Request) {
	p := principalFromContext(r.Context())
	if p.Role != RoleOwner && p.Role != RoleSuperadmin {
		writeError(w, r, http.StatusForbidden, "forbidden", "Owner role is required", nil)
		return
	}
	var input CreateApartmentInput
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	item, err := a.store.CreateApartment(r.Context(), p, input)
	if err != nil {
		a.handleStoreError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (a *API) handleListApplications(w http.ResponseWriter, r *http.Request) {
	p := principalFromContext(r.Context())
	filter := ApplicationFilter{Source: r.URL.Query().Get("source"), ManagerID: r.URL.Query().Get("managerId")}
	if status := Status(r.URL.Query().Get("status")); status != "" {
		if !status.Valid() {
			writeError(w, r, http.StatusBadRequest, "invalid_status", "Unknown status", nil)
			return
		}
		filter.Status = status
	}
	if value := r.URL.Query().Get("from"); value != "" {
		parsed, err := time.Parse(time.RFC3339, value)
		if err != nil {
			writeError(w, r, http.StatusBadRequest, "invalid_from", "from must be RFC3339", nil)
			return
		}
		filter.From = &parsed
	}
	if value := r.URL.Query().Get("to"); value != "" {
		parsed, err := time.Parse(time.RFC3339, value)
		if err != nil {
			writeError(w, r, http.StatusBadRequest, "invalid_to", "to must be RFC3339", nil)
			return
		}
		filter.To = &parsed
	}
	filter.Limit, _ = strconv.Atoi(r.URL.Query().Get("limit"))
	filter.Offset, _ = strconv.Atoi(r.URL.Query().Get("offset"))
	items, err := a.store.ListApplications(r.Context(), p.WorkspaceID, filter)
	if err != nil {
		a.handleStoreError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "limit": filter.Limit, "offset": filter.Offset})
}

func (a *API) handleCreateApplication(w http.ResponseWriter, r *http.Request) {
	p := principalFromContext(r.Context())
	var input CreateApplicationInput
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	item, err := a.store.CreateApplication(r.Context(), p, input)
	if err != nil {
		a.handleStoreError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (a *API) handleGetApplication(w http.ResponseWriter, r *http.Request) {
	p := principalFromContext(r.Context())
	result, err := a.store.GetApplicationDetail(r.Context(), p.WorkspaceID, r.PathValue("id"))
	if err != nil {
		a.handleStoreError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (a *API) handleUpdateApplication(w http.ResponseWriter, r *http.Request) {
	p := principalFromContext(r.Context())
	var input UpdateApplicationInput
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	item, err := a.store.UpdateApplication(r.Context(), p, r.PathValue("id"), input)
	if err != nil {
		a.handleStoreError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (a *API) handleClaimApplication(w http.ResponseWriter, r *http.Request) {
	p := principalFromContext(r.Context())
	item, err := a.store.ClaimApplication(r.Context(), p, r.PathValue("id"))
	if err != nil {
		a.handleStoreError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (a *API) handleUpdateStatus(w http.ResponseWriter, r *http.Request) {
	p := principalFromContext(r.Context())
	var input struct {
		Status      Status `json:"status"`
		LockVersion int64  `json:"lockVersion"`
	}
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	item, err := a.store.UpdateStatus(r.Context(), p, r.PathValue("id"), input.Status, input.LockVersion)
	if err != nil {
		a.handleStoreError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (a *API) handleAddComment(w http.ResponseWriter, r *http.Request) {
	p := principalFromContext(r.Context())
	var input struct {
		Text string `json:"text"`
	}
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	item, err := a.store.AddComment(r.Context(), p, r.PathValue("id"), input.Text)
	if err != nil {
		a.handleStoreError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (a *API) handleAddPayment(w http.ResponseWriter, r *http.Request) {
	p := principalFromContext(r.Context())
	var input CreatePaymentInput
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	payment, application, err := a.store.AddPayment(r.Context(), p, r.PathValue("id"), input)
	if err != nil {
		a.handleStoreError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"payment": payment, "application": application})
}

func (a *API) handleAddRefund(w http.ResponseWriter, r *http.Request) {
	p := principalFromContext(r.Context())
	var input CreateRefundInput
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	payment, application, err := a.store.AddRefund(r.Context(), p, r.PathValue("id"), input)
	if err != nil {
		a.handleStoreError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"refund": payment, "application": application})
}

func (a *API) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(sessionCookie)
		if err != nil || strings.TrimSpace(cookie.Value) == "" {
			writeError(w, r, http.StatusUnauthorized, "unauthorized", "Authentication required", nil)
			return
		}
		principal, err := a.store.PrincipalByToken(r.Context(), DigestSecret(cookie.Value))
		if err != nil {
			a.clearSessionCookies(w)
			writeError(w, r, http.StatusUnauthorized, "unauthorized", "Session is invalid or expired", nil)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), principalKey, principal)))
	})
}

func (a *API) requireCSRF(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}
		p := principalFromContext(r.Context())
		header := strings.TrimSpace(r.Header.Get("X-CSRF-Token"))
		cookie, err := r.Cookie(csrfCookie)
		if err != nil || header == "" || subtle.ConstantTimeCompare([]byte(header), []byte(cookie.Value)) != 1 || !SecretMatches(header, p.CSRFHash) {
			writeError(w, r, http.StatusForbidden, "csrf_failed", "CSRF validation failed", nil)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (a *API) cors(next http.Handler) http.Handler {
	allowed := map[string]bool{}
	for _, origin := range a.cfg.AllowedOrigins {
		allowed[origin] = true
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := strings.TrimRight(r.Header.Get("Origin"), "/")
		if origin != "" && allowed[origin] {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Add("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			if origin == "" || !allowed[origin] {
				w.WriteHeader(http.StatusForbidden)
				return
			}
			w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type,X-CSRF-Token,X-Request-ID")
			w.Header().Set("Access-Control-Max-Age", "600")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (a *API) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("Permissions-Policy", "camera=(self), geolocation=(), microphone=()")
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

func (a *API) requestContext(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := truncate(strings.TrimSpace(r.Header.Get("X-Request-ID")), 100)
		if id == "" {
			raw, _, _ := NewSecret()
			id = raw[:16]
		}
		w.Header().Set("X-Request-ID", id)
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), requestIDKey, id)))
	})
}

type responseRecorder struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (r *responseRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

func (r *responseRecorder) Write(data []byte) (int, error) {
	if r.status == 0 {
		r.status = http.StatusOK
	}
	n, err := r.ResponseWriter.Write(data)
	r.bytes += n
	return n, err
}

func (a *API) accessLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		recorder := &responseRecorder{ResponseWriter: w}
		next.ServeHTTP(recorder, r)
		a.logger.InfoContext(r.Context(), "http request", "request_id", requestID(r.Context()), "method", r.Method, "path", r.URL.Path, "status", recorder.status, "bytes", recorder.bytes, "duration_ms", time.Since(start).Milliseconds(), "ip", clientIP(r))
	})
}

func (a *API) recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				a.logger.ErrorContext(r.Context(), "panic recovered", "request_id", requestID(r.Context()), "panic", recovered)
				writeError(w, r, http.StatusInternalServerError, "internal_error", "Internal server error", nil)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func (a *API) setSessionCookies(w http.ResponseWriter, token, csrf string, expires time.Time) {
	maxAge := int(time.Until(expires).Seconds())
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: token, Path: "/", HttpOnly: true, Secure: a.cfg.CookieSecure, SameSite: http.SameSiteLaxMode, Expires: expires, MaxAge: maxAge})
	http.SetCookie(w, &http.Cookie{Name: csrfCookie, Value: csrf, Path: "/", HttpOnly: false, Secure: a.cfg.CookieSecure, SameSite: http.SameSiteLaxMode, Expires: expires, MaxAge: maxAge})
}

func (a *API) clearSessionCookies(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", HttpOnly: true, Secure: a.cfg.CookieSecure, SameSite: http.SameSiteLaxMode, MaxAge: -1})
	http.SetCookie(w, &http.Cookie{Name: csrfCookie, Value: "", Path: "/", HttpOnly: false, Secure: a.cfg.CookieSecure, SameSite: http.SameSiteLaxMode, MaxAge: -1})
}

func (a *API) internalError(w http.ResponseWriter, r *http.Request, err error) {
	a.logger.ErrorContext(r.Context(), "internal error", "request_id", requestID(r.Context()), "error", err)
	writeError(w, r, http.StatusInternalServerError, "internal_error", "Internal server error", nil)
}

func (a *API) handleStoreError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		writeError(w, r, http.StatusNotFound, "not_found", "Resource not found", nil)
	case errors.Is(err, ErrUnauthorized):
		writeError(w, r, http.StatusUnauthorized, "unauthorized", "Authentication required", nil)
	case errors.Is(err, ErrForbidden):
		writeError(w, r, http.StatusForbidden, "forbidden", "You cannot change this resource", nil)
	case errors.Is(err, ErrAlreadyClaimed):
		writeError(w, r, http.StatusConflict, "already_claimed", "Application was already claimed", nil)
	case errors.Is(err, ErrHardConflict):
		writeError(w, r, http.StatusConflict, "hard_conflict", "Apartment already has a guaranteed booking in this interval", nil)
	case errors.Is(err, ErrConflict):
		writeError(w, r, http.StatusConflict, "version_conflict", "Resource changed. Reload and try again", nil)
	case errors.Is(err, ErrValidation), errors.Is(err, ErrInvalidTransition):
		writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", err.Error(), nil)
	default:
		a.internalError(w, r, err)
	}
}

func (l *loginLimiter) allow(key string) bool {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	entry := l.entries[key]
	if entry.Reset.Before(now) {
		entry = loginWindow{Reset: now.Add(10 * time.Minute)}
	}
	entry.Count++
	l.entries[key] = entry
	if len(l.entries) > 5000 {
		for k, v := range l.entries {
			if v.Reset.Before(now) {
				delete(l.entries, k)
			}
		}
	}
	return entry.Count <= 10
}

func principalFromContext(ctx context.Context) Principal {
	value, _ := ctx.Value(principalKey).(Principal)
	return value
}

func requestID(ctx context.Context) string {
	value, _ := ctx.Value(requestIDKey).(string)
	return value
}

func clientIP(r *http.Request) string {
	if forwarded := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-For"), ",")[0]); forwarded != "" {
		return forwarded
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return host
	}
	return r.RemoteAddr
}

func decodeJSON(w http.ResponseWriter, r *http.Request, destination any) error {
	if contentType := r.Header.Get("Content-Type"); contentType != "" && !strings.HasPrefix(contentType, "application/json") {
		return fmt.Errorf("Content-Type must be application/json")
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		if errors.Is(err, io.EOF) {
			return fmt.Errorf("request body is required")
		}
		return fmt.Errorf("invalid JSON: %w", err)
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return fmt.Errorf("request body must contain one JSON object")
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, r *http.Request, status int, code, message string, details any) {
	body := map[string]any{"error": map[string]any{"code": code, "message": message, "requestId": requestID(r.Context())}}
	if details != nil {
		body["error"].(map[string]any)["details"] = details
	}
	writeJSON(w, status, body)
}

func truncate(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	return value[:limit]
}
