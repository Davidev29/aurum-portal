export interface Migration {
  version: number
  name: string
  sql: string
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    sql: `
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('PF', 'PJ')),
  name TEXT NOT NULL,
  document TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  notes TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  consent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS clients_document_unique ON clients(document);
CREATE INDEX IF NOT EXISTS clients_name_idx ON clients(name);
CREATE INDEX IF NOT EXISTS clients_status_idx ON clients(status);

CREATE TABLE IF NOT EXISTS certificates (
  id TEXT PRIMARY KEY NOT NULL,
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  label TEXT NOT NULL,
  holder_name TEXT NOT NULL,
  document TEXT,
  document_type TEXT NOT NULL CHECK (document_type IN ('CPF', 'CNPJ', 'OTHER')),
  subject_dn TEXT NOT NULL,
  issuer_dn TEXT NOT NULL,
  serial_hex TEXT NOT NULL,
  thumbprint_sha1 TEXT NOT NULL,
  thumbprint_sha256 TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_to TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('pfx', 'windows')),
  pfx_enc TEXT,
  pfx_password_enc TEXT,
  installed INTEGER NOT NULL DEFAULT 0,
  installed_at TEXT,
  last_seen_at TEXT,
  chain_status TEXT,
  status_override TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS certificates_thumbprint_sha256_unique ON certificates(thumbprint_sha256);
CREATE INDEX IF NOT EXISTS certificates_client_idx ON certificates(client_id);
CREATE INDEX IF NOT EXISTS certificates_valid_to_idx ON certificates(valid_to);

CREATE TABLE IF NOT EXISTS certificate_clients (
  certificate_id TEXT NOT NULL REFERENCES certificates(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  consent_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (certificate_id, client_id)
);
CREATE INDEX IF NOT EXISTS certificate_clients_client_idx ON certificate_clients(client_id);

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  base_url TEXT NOT NULL,
  allowed_domains_json TEXT NOT NULL,
  auth_methods_json TEXT NOT NULL,
  default_auth TEXT NOT NULL CHECK (default_auth IN ('certificate', 'password')),
  logo_path TEXT,
  notes TEXT,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  favorite INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS services_slug_unique ON services(slug);
CREATE INDEX IF NOT EXISTS services_category_idx ON services(category);

CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  username TEXT NOT NULL,
  username_type TEXT NOT NULL CHECK (username_type IN ('cpf', 'cnpj', 'email', 'other')),
  password_enc TEXT NOT NULL,
  password_fingerprint TEXT NOT NULL,
  notes TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  password_changed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS credentials_client_service_idx ON credentials(client_id, service_id);
CREATE INDEX IF NOT EXISTS credentials_fingerprint_idx ON credentials(password_fingerprint);

CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY NOT NULL,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  definition_json TEXT NOT NULL,
  auto_submit INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'verified', 'broken', 'disabled')),
  last_verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS recipes_service_unique ON recipes(service_id);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  certificate_id TEXT REFERENCES certificates(id) ON DELETE SET NULL,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  credential_id TEXT REFERENCES credentials(id) ON DELETE SET NULL,
  auth_method TEXT NOT NULL CHECK (auth_method IN ('certificate', 'password')),
  partition TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'opening' CHECK (status IN ('opening', 'awaiting_login', 'authenticated', 'manual', 'error', 'closed')),
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS sessions_client_idx ON sessions(client_id);
CREATE INDEX IF NOT EXISTS sessions_opened_idx ON sessions(opened_at);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_events_created_idx ON audit_events(created_at);
CREATE INDEX IF NOT EXISTS audit_events_type_idx ON audit_events(type);
CREATE INDEX IF NOT EXISTS audit_events_entity_idx ON audit_events(entity, entity_id);

CREATE TRIGGER IF NOT EXISTS audit_events_no_update
BEFORE UPDATE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit_events e append-only');
END;

CREATE TRIGGER IF NOT EXISTS audit_events_no_delete
BEFORE DELETE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit_events e append-only');
END;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`,
  },
  {
    version: 2,
    name: 'credential_fields',
    sql: `ALTER TABLE credentials ADD COLUMN fields_json TEXT;`,
  },
  {
    version: 3,
    name: 'client_notes',
    sql: `
CREATE TABLE IF NOT EXISTS client_notes (
  id TEXT PRIMARY KEY NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS client_notes_client_idx ON client_notes(client_id);
INSERT INTO client_notes (id, client_id, text, created_at, updated_at)
  SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',1+ (abs(random()) %4),1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))), id, notes, created_at, updated_at FROM clients WHERE notes IS NOT NULL AND trim(notes) != '';
`,
  },
  {
    version: 4,
    name: 'client_honorarios',
    sql: `ALTER TABLE clients ADD COLUMN honorarios_cents INTEGER;`,
  },
  {
    version: 5,
    name: 'obligations',
    sql: `
CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS departments_name_unique ON departments(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS departments_active_idx ON departments(active);

CREATE TABLE IF NOT EXISTS obligations (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  sigla TEXT NOT NULL,
  description TEXT,
  department_id TEXT NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  recurrence TEXT NOT NULL CHECK (recurrence IN ('mensal', 'bimestral', 'trimestral', 'semestral', 'anual', 'eventual')),
  due_rule TEXT CHECK (due_rule IN ('dia_fixo', 'dia_util')),
  dia_fixo INTEGER CHECK (dia_fixo IS NULL OR (dia_fixo BETWEEN 1 AND 31)),
  dia_util INTEGER CHECK (dia_util IS NULL OR (dia_util BETWEEN 1 AND 15)),
  mes_referencia INTEGER CHECK (mes_referencia IS NULL OR (mes_referencia BETWEEN 1 AND 12)),
  antecedencia_notificacao_dias INTEGER NOT NULL DEFAULT 7 CHECK (antecedencia_notificacao_dias BETWEEN 0 AND 90),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS obligations_department_sigla_unique ON obligations(department_id, sigla COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS obligations_department_idx ON obligations(department_id);
CREATE INDEX IF NOT EXISTS obligations_active_idx ON obligations(active);

CREATE TABLE IF NOT EXISTS obligation_groups (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS obligation_groups_name_unique ON obligation_groups(name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS obligation_group_items (
  group_id TEXT NOT NULL REFERENCES obligation_groups(id) ON DELETE CASCADE,
  obligation_id TEXT NOT NULL REFERENCES obligations(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, obligation_id)
);
CREATE INDEX IF NOT EXISTS obligation_group_items_obligation_idx ON obligation_group_items(obligation_id);

CREATE TABLE IF NOT EXISTS client_obligations (
  id TEXT PRIMARY KEY NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  obligation_id TEXT NOT NULL REFERENCES obligations(id) ON DELETE CASCADE,
  data_inicio TEXT NOT NULL,
  data_fim TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS client_obligations_unique ON client_obligations(client_id, obligation_id);
CREATE INDEX IF NOT EXISTS client_obligations_obligation_idx ON client_obligations(obligation_id);
CREATE INDEX IF NOT EXISTS client_obligations_active_idx ON client_obligations(active);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('obligation.due')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  obligation_id TEXT REFERENCES obligations(id) ON DELETE SET NULL,
  client_id TEXT REFERENCES clients(id) ON DELETE CASCADE,
  due_date TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS notifications_read_idx ON notifications(read);
CREATE INDEX IF NOT EXISTS notifications_created_idx ON notifications(created_at);
CREATE INDEX IF NOT EXISTS notifications_dedupe_idx ON notifications(type, obligation_id, client_id, due_date);

CREATE TABLE IF NOT EXISTS extra_holidays (
  id TEXT PRIMARY KEY NOT NULL,
  date TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS extra_holidays_date_unique ON extra_holidays(date);
`,
  },
]
