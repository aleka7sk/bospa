CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE OR REPLACE FUNCTION bospa_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 160),
  city text NOT NULL DEFAULT 'Астана',
  timezone text NOT NULL DEFAULT 'Asia/Almaty',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('trial','active','read_only','suspended','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email citext NOT NULL,
  password_hash text NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 160),
  short_name text NOT NULL CHECK (length(trim(short_name)) BETWEEN 1 AND 80),
  role text NOT NULL CHECK (role IN ('owner','manager','superadmin')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz,
  UNIQUE (workspace_id, email)
);
CREATE INDEX IF NOT EXISTS users_workspace_active_idx ON users(workspace_id, active, role);
CREATE UNIQUE INDEX IF NOT EXISTS users_global_email_active_idx ON users(email) WHERE active;

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  csrf_hash bytea NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  user_agent text NOT NULL DEFAULT '',
  ip inet,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sessions_one_active_per_user_idx ON sessions(user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS apartments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  code text NOT NULL CHECK (length(trim(code)) BETWEEN 1 AND 64),
  address text NOT NULL CHECK (length(trim(address)) BETWEEN 2 AND 240),
  unit text NOT NULL CHECK (length(trim(unit)) BETWEEN 1 AND 64),
  city text NOT NULL DEFAULT 'Астана',
  district text NOT NULL DEFAULT '',
  complex text NOT NULL DEFAULT '',
  rooms integer NOT NULL DEFAULT 1 CHECK (rooms >= 0 AND rooms <= 30),
  capacity integer NOT NULL DEFAULT 1 CHECK (capacity >= 1 AND capacity <= 100),
  check_in_time time NOT NULL DEFAULT '14:00',
  check_out_time time NOT NULL DEFAULT '12:00',
  weekday_rate_tiyn bigint NOT NULL DEFAULT 0 CHECK (weekday_rate_tiyn >= 0),
  weekend_rate_tiyn bigint NOT NULL DEFAULT 0 CHECK (weekend_rate_tiyn >= 0),
  active boolean NOT NULL DEFAULT true,
  catalog_enabled boolean NOT NULL DEFAULT false,
  published boolean NOT NULL DEFAULT false,
  lock_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (workspace_id, code)
);
CREATE INDEX IF NOT EXISTS apartments_workspace_active_idx ON apartments(workspace_id, active) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  apartment_id uuid NOT NULL REFERENCES apartments(id),
  external_id text NOT NULL,
  source text NOT NULL DEFAULT 'Ручная',
  guest_name text NOT NULL DEFAULT '',
  phone text NOT NULL CHECK (length(trim(phone)) BETWEEN 5 AND 40),
  status text NOT NULL DEFAULT 'new' CHECK (status IN (
    'new','no_answer','thinking','awaiting_prepayment','prepaid','paid','completed',
    'declined','unpaid','cancelled_client','cancelled_company','duplicate','error','technical'
  )),
  check_in_at timestamptz NOT NULL,
  check_out_at timestamptz NOT NULL,
  total_amount_tiyn bigint NOT NULL DEFAULT 0 CHECK (total_amount_tiyn >= 0),
  required_prepayment_tiyn bigint NOT NULL DEFAULT 0 CHECK (required_prepayment_tiyn >= 0),
  paid_amount_tiyn bigint NOT NULL DEFAULT 0,
  deposit_amount_tiyn bigint NOT NULL DEFAULT 0 CHECK (deposit_amount_tiyn >= 0),
  claimed_by uuid REFERENCES users(id),
  credited_manager_id uuid REFERENCES users(id),
  is_test boolean NOT NULL DEFAULT false,
  needs_alternative boolean NOT NULL DEFAULT false,
  pinned_note text NOT NULL DEFAULT '',
  lock_version bigint NOT NULL DEFAULT 1,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (check_out_at > check_in_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS applications_external_id_idx
  ON applications(workspace_id, source, external_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS applications_calendar_idx
  ON applications(workspace_id, apartment_id, check_in_at, check_out_at)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS applications_queue_idx
  ON applications(workspace_id, status, claimed_by, updated_at DESC)
  WHERE deleted_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'applications_no_hard_overlap'
  ) THEN
    ALTER TABLE applications
      ADD CONSTRAINT applications_no_hard_overlap
      EXCLUDE USING gist (
        workspace_id WITH =,
        apartment_id WITH =,
        tstzrange(check_in_at, check_out_at, '[)') WITH &&
      )
      WHERE (
        status IN ('prepaid','paid','technical')
        AND is_test = false
        AND deleted_at IS NULL
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  amount_tiyn bigint NOT NULL CHECK (amount_tiyn <> 0),
  kind text NOT NULL CHECK (kind IN ('rent','deposit','refund','adjustment')),
  method text NOT NULL CHECK (length(trim(method)) BETWEEN 1 AND 80),
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending','confirmed','rejected','voided')),
  note text NOT NULL DEFAULT '',
  received_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_application_idx ON payments(workspace_id, application_id, received_at DESC);

CREATE TABLE IF NOT EXISTS comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id),
  body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS comments_application_idx ON comments(workspace_id, application_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS application_events (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  text text NOT NULL,
  actor_id uuid REFERENCES users(id),
  actor_name text NOT NULL DEFAULT 'Система',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS application_events_application_idx ON application_events(workspace_id, application_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  request_id text NOT NULL DEFAULT '',
  ip inet,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_workspace_idx ON audit_log(workspace_id, created_at DESC);

DROP TRIGGER IF EXISTS workspaces_set_updated_at ON workspaces;
CREATE TRIGGER workspaces_set_updated_at BEFORE UPDATE ON workspaces
FOR EACH ROW EXECUTE FUNCTION bospa_set_updated_at();
DROP TRIGGER IF EXISTS users_set_updated_at ON users;
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION bospa_set_updated_at();
DROP TRIGGER IF EXISTS apartments_set_updated_at ON apartments;
CREATE TRIGGER apartments_set_updated_at BEFORE UPDATE ON apartments
FOR EACH ROW EXECUTE FUNCTION bospa_set_updated_at();
DROP TRIGGER IF EXISTS applications_set_updated_at ON applications;
CREATE TRIGGER applications_set_updated_at BEFORE UPDATE ON applications
FOR EACH ROW EXECUTE FUNCTION bospa_set_updated_at();
