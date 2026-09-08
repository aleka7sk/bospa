# bospa API

Go/PostgreSQL backend for the Bospa booking calendar.

## Local run

```bash
cp .env.example .env
set -a; source .env; set +a
go run ./cmd/api
```

The API listens on `:8080`. Embedded migrations run under a PostgreSQL advisory lock when `BOSPA_AUTO_MIGRATE=true`.

The easiest full-stack launch is from the repository root:

```bash
cp .env.example .env
docker compose up --build
```

Then use the application through `http://localhost:4173`; the web service proxies `/api/*` to the API.

## Implemented HTTP surface

- authentication: login, session restore, logout;
- workspace bootstrap with users, apartments and applications;
- apartment listing and creation;
- application listing, creation, detail and optimistic updates;
- atomic claim;
- validated status transitions and hard-conflict protection;
- comments and contact outcomes;
- payments and owner-only refunds;
- liveness/readiness endpoints.

Contract: [`openapi/openapi.yaml`](openapi/openapi.yaml).

## Security model

- opaque 256-bit session token in an `HttpOnly` cookie;
- CSRF double-submit token plus server-side digest verification;
- one active interactive session per user;
- bcrypt password hashes;
- workspace scope in every business-data query;
- owner/manager role checks;
- atomic claim update;
- PostgreSQL exclusion constraint for hard booking conflicts;
- optimistic `lockVersion` on edits;
- immutable application timeline and audit log;
- security headers, origin validation and login rate limiting;
- no credentials or raw session secrets in application logs.

## Monetary values

All API monetary fields use integer **tiyn**. Example: `2500000` means `25 000 ₸`.

## Verification

```bash
go mod tidy
test -z "$(gofmt -l .)"
go vet ./...
go test -race -count=1 ./...
go build ./cmd/api
```

GitHub Actions also starts PostgreSQL and executes an authenticated end-to-end API smoke test.

## Health

- `GET /api/v1/health/live`
- `GET /api/v1/health/ready`
