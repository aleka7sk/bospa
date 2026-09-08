package bospa

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"strings"
	"time"
)

func (api *API) auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(sessionCookieName)
		if err != nil || cookie.Value == "" {
			writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", "Требуется вход.")
			return
		}
		principal, err := api.store.PrincipalByToken(r.Context(), DigestSecret(cookie.Value))
		if err != nil {
			api.clearAuthCookies(w)
			writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", "Сессия истекла или была отозвана.")
			return
		}
		ctx := context.WithValue(r.Context(), principalContextKey, &principal)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (api *API) csrf(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		principal := principalFromContext(r.Context())
		if principal == nil {
			writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", "Требуется вход.")
			return
		}
		raw := r.Header.Get("X-CSRF-Token")
		cookie, err := r.Cookie(csrfCookieName)
		if err != nil || raw == "" || cookie.Value == "" || raw != cookie.Value || !SecretMatches(raw, principal.CSRFHash) {
			writeAPIError(w, r, http.StatusForbidden, "csrf_failed", "Защитный токен недействителен. Обновите страницу.")
			return
		}
		if origin := strings.TrimRight(r.Header.Get("Origin"), "/"); origin != "" && !api.originAllowed(origin) {
			writeAPIError(w, r, http.StatusForbidden, "origin_forbidden", "Источник запроса не разрешён.")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (api *API) requireRoles(roles ...Role) func(http.Handler) http.Handler {
	allowed := make(map[Role]struct{}, len(roles))
	for _, role := range roles {
		allowed[role] = struct{}{}
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			principal := principalFromContext(r.Context())
			if principal == nil {
				writeAPIError(w, r, http.StatusUnauthorized, "unauthorized", "Требуется вход.")
				return
			}
			if _, ok := allowed[principal.Role]; !ok {
				writeAPIError(w, r, http.StatusForbidden, "forbidden", "Недостаточно прав.")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func (api *API) requestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := strings.TrimSpace(r.Header.Get("X-Request-ID"))
		if requestID == "" || len(requestID) > 128 {
			buffer := make([]byte, 12)
			_, _ = rand.Read(buffer)
			requestID = hex.EncodeToString(buffer)
		}
		w.Header().Set("X-Request-ID", requestID)
		ctx := context.WithValue(r.Context(), requestIDContextKey, requestID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (api *API) recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				api.logger.Error("http panic", "request_id", requestIDFromContext(r.Context()), "panic", recovered)
				writeAPIError(w, r, http.StatusInternalServerError, "internal_error", "Внутренняя ошибка сервера.")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

type responseRecorder struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (r *responseRecorder) WriteHeader(status int) {
	if r.status == 0 {
		r.status = status
	}
	r.ResponseWriter.WriteHeader(status)
}

func (r *responseRecorder) Write(payload []byte) (int, error) {
	if r.status == 0 {
		r.status = http.StatusOK
	}
	n, err := r.ResponseWriter.Write(payload)
	r.bytes += n
	return n, err
}

func (api *API) accessLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		recorder := &responseRecorder{ResponseWriter: w}
		next.ServeHTTP(recorder, r)
		status := recorder.status
		if status == 0 {
			status = http.StatusOK
		}
		api.logger.Info("http request",
			"request_id", requestIDFromContext(r.Context()),
			"method", r.Method,
			"path", r.URL.Path,
			"status", status,
			"bytes", recorder.bytes,
			"duration_ms", time.Since(started).Milliseconds(),
			"remote_ip", remoteIP(r).String(),
		)
	})
}

func (api *API) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		w.Header().Set("Cache-Control", "no-store")
		if api.cfg.CookieSecure {
			w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		next.ServeHTTP(w, r)
	})
}

func (api *API) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := strings.TrimRight(r.Header.Get("Origin"), "/")
		if origin != "" && api.originAllowed(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token, X-Request-ID")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
			w.Header().Add("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			if origin == "" || !api.originAllowed(origin) {
				w.WriteHeader(http.StatusForbidden)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (api *API) originAllowed(origin string) bool {
	for _, allowed := range api.cfg.AllowedOrigins {
		if origin == allowed {
			return true
		}
	}
	return false
}

func (api *API) setAuthCookies(w http.ResponseWriter, sessionToken, csrfToken string, expiresAt time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookieName, Value: sessionToken, Path: "/", HttpOnly: true,
		Secure: api.cfg.CookieSecure, SameSite: http.SameSiteLaxMode, Expires: expiresAt,
	})
	http.SetCookie(w, &http.Cookie{
		Name: csrfCookieName, Value: csrfToken, Path: "/", HttpOnly: false,
		Secure: api.cfg.CookieSecure, SameSite: http.SameSiteLaxMode, Expires: expiresAt,
	})
}

func (api *API) clearAuthCookies(w http.ResponseWriter) {
	for _, name := range []string{sessionCookieName, csrfCookieName} {
		http.SetCookie(w, &http.Cookie{Name: name, Value: "", Path: "/", HttpOnly: name == sessionCookieName, Secure: api.cfg.CookieSecure, SameSite: http.SameSiteLaxMode, MaxAge: -1, Expires: time.Unix(1, 0)})
	}
}
