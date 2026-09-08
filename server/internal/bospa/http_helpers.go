package bospa

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

func (api *API) writeError(w http.ResponseWriter, r *http.Request, err error) {
	status, code, message := http.StatusInternalServerError, "internal_error", "Внутренняя ошибка сервера."
	switch {
	case errors.Is(err, ErrUnauthorized):
		status, code, message = http.StatusUnauthorized, "unauthorized", "Требуется вход."
	case errors.Is(err, ErrForbidden):
		status, code, message = http.StatusForbidden, "forbidden", "Недостаточно прав."
	case errors.Is(err, ErrNotFound):
		status, code, message = http.StatusNotFound, "not_found", "Запись не найдена."
	case errors.Is(err, ErrAlreadyClaimed):
		status, code, message = http.StatusConflict, "already_claimed", "Заявку уже взял другой менеджер."
	case errors.Is(err, ErrHardConflict):
		status, code, message = http.StatusConflict, "hard_conflict", "Квартира уже занята гарантированной бронью."
	case errors.Is(err, ErrConflict):
		status, code, message = http.StatusConflict, "conflict", "Данные уже изменились. Обновите карточку."
	case errors.Is(err, ErrInvalidStatus), errors.Is(err, ErrInvalidTransition), errors.Is(err, ErrValidation):
		status, code, message = http.StatusUnprocessableEntity, "validation_error", userSafeError(err)
	default:
		api.logger.Error("request failed", "request_id", requestIDFromContext(r.Context()), "error", err)
	}
	writeAPIError(w, r, status, code, message)
}

func userSafeError(err error) string {
	message := err.Error()
	if index := strings.Index(message, ": "); index >= 0 && index+2 < len(message) {
		message = message[index+2:]
	}
	if message == "" {
		return "Проверьте введённые данные."
	}
	return message
}

func decodeJSON(w http.ResponseWriter, r *http.Request, destination any) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBody)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		if errors.Is(err, io.EOF) {
			return fmt.Errorf("тело запроса обязательно")
		}
		return fmt.Errorf("некорректный JSON: %w", err)
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return fmt.Errorf("после JSON обнаружены лишние данные")
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeAPIError(w http.ResponseWriter, r *http.Request, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]any{
		"code": code, "message": message, "requestId": requestIDFromContext(r.Context()),
	}})
}

func principalFromContext(ctx context.Context) *Principal {
	principal, _ := ctx.Value(principalContextKey).(*Principal)
	return principal
}

func mustPrincipal(ctx context.Context) *Principal {
	principal := principalFromContext(ctx)
	if principal == nil {
		panic("authenticated handler called without principal")
	}
	return principal
}

func requestIDFromContext(ctx context.Context) string {
	requestID, _ := ctx.Value(requestIDContextKey).(string)
	return requestID
}

func remoteIP(r *http.Request) net.IP {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return net.ParseIP(host)
	}
	return net.ParseIP(r.RemoteAddr)
}

func parseDateOrTime(value, timezone string, endOfDay bool) (*time.Time, error) {
	if strings.TrimSpace(value) == "" {
		return nil, nil
	}
	if parsed, err := time.Parse(time.RFC3339, value); err == nil {
		parsed = parsed.UTC()
		return &parsed, nil
	}
	location, err := time.LoadLocation(timezone)
	if err != nil {
		location = time.UTC
	}
	parsed, err := time.ParseInLocation("2006-01-02", value, location)
	if err != nil {
		return nil, fmt.Errorf("дата %q должна быть YYYY-MM-DD или RFC3339", value)
	}
	if endOfDay {
		parsed = parsed.Add(24 * time.Hour)
	}
	parsed = parsed.UTC()
	return &parsed, nil
}

func calendarRange(r *http.Request, timezone string) (time.Time, time.Time, error) {
	from, err := parseDateOrTime(r.URL.Query().Get("from"), timezone, false)
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	to, err := parseDateOrTime(r.URL.Query().Get("to"), timezone, true)
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	now := time.Now().UTC()
	if from == nil {
		value := now.AddDate(0, 0, -35)
		from = &value
	}
	if to == nil {
		value := now.AddDate(0, 0, 140)
		to = &value
	}
	if !to.After(*from) || to.Sub(*from) > 730*24*time.Hour {
		return time.Time{}, time.Time{}, fmt.Errorf("диапазон должен быть положительным и не больше 730 дней")
	}
	return *from, *to, nil
}

func applicationFilter(r *http.Request, timezone string) (ListApplicationsFilter, error) {
	filter := ListApplicationsFilter{Source: strings.TrimSpace(r.URL.Query().Get("source")), ManagerID: strings.TrimSpace(r.URL.Query().Get("managerId"))}
	if raw := strings.TrimSpace(r.URL.Query().Get("status")); raw != "" {
		filter.Status = ApplicationStatus(raw)
		if !filter.Status.Valid() {
			return filter, fmt.Errorf("неизвестный статус")
		}
	}
	from, err := parseDateOrTime(r.URL.Query().Get("from"), timezone, false)
	if err != nil {
		return filter, err
	}
	to, err := parseDateOrTime(r.URL.Query().Get("to"), timezone, true)
	if err != nil {
		return filter, err
	}
	filter.From, filter.To = from, to
	if value := r.URL.Query().Get("limit"); value != "" {
		filter.Limit, err = strconv.Atoi(value)
		if err != nil {
			return filter, fmt.Errorf("limit должен быть числом")
		}
	}
	if value := r.URL.Query().Get("offset"); value != "" {
		filter.Offset, err = strconv.Atoi(value)
		if err != nil {
			return filter, fmt.Errorf("offset должен быть числом")
		}
	}
	return filter, nil
}

type windowBucket struct {
	started time.Time
	count   int
}

type fixedWindowLimiter struct {
	mu      sync.Mutex
	limit   int
	window  time.Duration
	buckets map[string]windowBucket
}

func newFixedWindowLimiter(limit int, window time.Duration) *fixedWindowLimiter {
	return &fixedWindowLimiter{limit: limit, window: window, buckets: make(map[string]windowBucket)}
}

func (limiter *fixedWindowLimiter) Allow(key string) bool {
	limiter.mu.Lock()
	defer limiter.mu.Unlock()
	now := time.Now()
	bucket := limiter.buckets[key]
	if bucket.started.IsZero() || now.Sub(bucket.started) >= limiter.window {
		limiter.buckets[key] = windowBucket{started: now, count: 1}
		return true
	}
	if bucket.count >= limiter.limit {
		return false
	}
	bucket.count++
	limiter.buckets[key] = bucket
	return true
}

func validateOrigin(raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return fmt.Errorf("invalid origin")
	}
	return nil
}
