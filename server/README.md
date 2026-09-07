# bospa API

Production foundation for the Bospa booking calendar.

## Local run

```bash
cp .env.example .env
set -a; source .env; set +a
go run ./cmd/api
```

The API listens on `:8080`. Database migrations are embedded into the binary and run under a PostgreSQL advisory lock.

## Security model

- opaque 256-bit session token in an `HttpOnly` cookie;
- CSRF double-submit token plus server-side digest verification;
- only one active interactive session per user;
- bcrypt cost 12 password hashes;
- workspace scope in every query;
- owner/manager role checks;
- atomic claim update;
- PostgreSQL exclusion constraint for hard booking conflicts;
- optimistic `lockVersion` on edits;
- immutable application timeline and audit log;
- no sensitive values in application logs.

## Amounts

All API monetary fields use integer **tiyn**. Example: `2500000` means `25 000 ₸`.

## Health

- `GET /api/v1/health/live`
- `GET /api/v1/health/ready`
