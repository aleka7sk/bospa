# Bospa full-stack runbook

This runbook describes the current production-oriented development stack: the mobile-first PWA, the Go HTTP API and PostgreSQL.

## Prerequisites

- Docker Desktop with Compose v2;
- Node.js 20 or newer for standalone web development;
- Go version declared in `server/go.mod` for standalone API development.

## First start

```bash
cp .env.example .env
# Change BOSPA_POSTGRES_PASSWORD and BOSPA_BOOTSTRAP_OWNER_PASSWORD.
make dev
```

Open `http://localhost:4173`.

The first API start applies database migrations and creates the bootstrap owner/workspace from `.env`. The password is not committed to Git and must be changed before any shared deployment.

## Services

```text
Browser/PWA :4173
    │ same-origin /api/v1 proxy
    ▼
Go API      :8080
    │
    ▼
PostgreSQL  :5432 (container network; do not expose in production)
```

The browser authenticates with an HttpOnly session cookie. Mutating requests use a CSRF token. The PWA attempts `/api/v1/bootstrap` on startup; an unauthenticated response opens the Bospa login screen. When the API cannot be reached, the user may explicitly enter the isolated demo mode.

## Common commands

```bash
make dev       # build and start the stack
make ps        # service status
make logs      # follow logs
make ci        # web checks + Go formatting/vet/race tests/build
make down      # stop services
make reset-db  # stop and delete the local database volume
```

## Web-only development

```bash
npm ci
npm run dev
```

Without the API, the login screen reports that the server is unavailable and offers an explicit local demo. For real persistence use Docker Compose or run the API separately.

## API-only development

```bash
cd server
cp .env.example .env
export BOSPA_DATABASE_URL='postgres://postgres:postgres@localhost:5432/bospa?sslmode=disable'
go run ./cmd/api
```

Readiness:

```bash
curl -fsS http://localhost:8080/api/v1/health/ready
```

## Authentication and synchronization

The PWA uses `/api/v1/auth/login` and `/api/v1/bootstrap`. Once authenticated, domain mutations are sent to the Go API. A small client-side mutation queue keeps optimistic work visible during a temporary connection loss and retries after the browser returns online. The server remains authoritative: a rejected hard conflict or stale lock causes a remote refresh.

The demo state and remote workspace are deliberately separated. Test applications remain marked as test data and do not create production hard availability or financial values.

## Local credentials

The defaults in `.env.example` are only for a developer laptop. Never deploy them. For a shared environment:

1. use long random passwords;
2. enable secure cookies and HTTPS;
3. keep PostgreSQL private;
4. use a secrets manager instead of `.env`;
5. rotate bootstrap credentials after the first owner login;
6. restrict CORS to the real Bospa origin.

## Database backup

Local development data lives in the Compose volume. Production must use managed PostgreSQL PITR and an independent encrypted backup in the secondary Kazakhstan region. A database volume is not a backup.

For a local disposable dump:

```bash
docker compose exec -T postgres pg_dump -U postgres -d bospa -Fc > bospa-local.dump
```

Restore into an empty local database:

```bash
docker compose exec -T postgres pg_restore -U postgres -d bospa --clean --if-exists < bospa-local.dump
```

## Verification before a push

```bash
make ci
docker compose up --build -d
curl -fsS http://localhost:4173/api/v1/health/ready
```

GitHub Actions repeats web checks, Go race tests, a real PostgreSQL API smoke test and a same-origin full-stack authentication smoke test.

## Current external boundaries

The following remain intentionally adapter-driven rather than faked:

- Booking/Connectivity partner ingestion;
- real Kaspi API or supported deep-link integration;
- S3-compatible receipt and apartment-photo storage;
- production push delivery;
- automatic subscription collection.

Their contracts can be implemented without changing the calendar domain model.
