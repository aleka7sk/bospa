package bospa

import (
	"fmt"
	"net/http"
	"strings"
	"time"
)

func (api *API) handleLive(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "service": "bospa-api"})
}

func (api *API) handleReady(w http.ResponseWriter, r *http.Request) {
	if err := api.store.Ping(r.Context()); err != nil {
		api.writeError(w, r, fmt.Errorf("readiness check: %w", err))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ready"})
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (api *API) handleLogin(w http.ResponseWriter, r *http.Request) {
	ip := remoteIP(r)
	if !api.loginLimiter.Allow(ip.String()) {
		writeAPIError(w, r, http.StatusTooManyRequests, "rate_limited", "Слишком много попыток. Повторите позже.")
		return
	}
	var input loginRequest
	if err := decodeJSON(w, r, &input); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	input.Email = strings.TrimSpace(strings.ToLower(input.Email))
	if input.Email == "" || input.Password == "" {
		writeAPIError(w, r, http.StatusUnprocessableEntity, "validation_error", "Email и пароль обязательны.")
		return
	}

	record, err := api.store.UserForLogin(r.Context(), input.Email)
	if err != nil {
		_ = VerifyPassword(api.dummyPasswordHash, input.Password)
		writeAPIError(w, r, http.StatusUnauthorized, "invalid_credentials", "Неверный email или пароль.")
		return
	}
	if !VerifyPassword(record.PasswordHash, input.Password) {
		writeAPIError(w, r, http.StatusUnauthorized, "invalid_credentials", "Неверный email или пароль.")
		return
	}

	sessionToken, sessionHash, err := NewSecret()
	if err != nil {
		api.writeError(w, r, err)
		return
	}
	csrfToken, csrfHash, err := NewSecret()
	if err != nil {
		api.writeError(w, r, err)
		return
	}
	expiresAt := time.Now().UTC().Add(api.cfg.SessionTTL)
	if _, err := api.store.CreateSession(r.Context(), record.ID, sessionHash, csrfHash, expiresAt, r.UserAgent(), ip); err != nil {
		api.writeError(w, r, err)
		return
	}
	api.setAuthCookies(w, sessionToken, csrfToken, expiresAt)
	principal, err := api.store.PrincipalByToken(r.Context(), sessionHash)
	if err != nil {
		api.writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user":      principal.User,
		"workspace": principal.Workspace,
		"expiresAt": principal.ExpiresAt,
		"csrfToken": csrfToken,
	})
}

func (api *API) handleLogout(w http.ResponseWriter, r *http.Request) {
	principal := principalFromContext(r.Context())
	if principal != nil {
		_ = api.store.RevokeSession(r.Context(), principal.SessionID)
	}
	api.clearAuthCookies(w)
	w.WriteHeader(http.StatusNoContent)
}

func (api *API) handleSession(w http.ResponseWriter, r *http.Request) {
	principal := mustPrincipal(r.Context())
	csrfToken := ""
	if cookie, err := r.Cookie(csrfCookieName); err == nil {
		csrfToken = cookie.Value
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user":      principal.User,
		"workspace": principal.Workspace,
		"expiresAt": principal.ExpiresAt,
		"csrfToken": csrfToken,
	})
}

func (api *API) handleBootstrap(w http.ResponseWriter, r *http.Request) {
	principal := mustPrincipal(r.Context())
	from, to, err := calendarRange(r, principal.Workspace.Timezone)
	if err != nil {
		writeAPIError(w, r, http.StatusUnprocessableEntity, "validation_error", err.Error())
		return
	}
	result, err := api.store.Bootstrap(r.Context(), *principal, from, to)
	if err != nil {
		api.writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
