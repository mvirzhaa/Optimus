-- Optimus: skema basis data PostgreSQL (versi 1)
-- Jalankan: psql "$DATABASE_URL" -f db/001_init.sql   (aman dijalankan ulang)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     INT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id             SERIAL PRIMARY KEY,
  username       TEXT NOT NULL UNIQUE CHECK (username ~ '^[a-zA-Z0-9_.-]{3,40}$'),
  display_name   TEXT NOT NULL DEFAULT '',
  password_hash  TEXT NOT NULL,                 -- scrypt$N$r$p$salt$hash
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,                 -- sha256 dari token (token asli tidak disimpan)
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

-- satu proyek = satu skenario (jaringan + demand + detektor + konfigurasi)
CREATE TABLE IF NOT EXISTS projects (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  description      TEXT NOT NULL DEFAULT '',
  current_version  INT NOT NULL DEFAULT 1,
  stats            JSONB NOT NULL DEFAULT '{}'::jsonb,   -- jumlah simpul/ruas/flow untuk daftar
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS projects_owner_idx ON projects(owner_id, updated_at DESC) WHERE deleted_at IS NULL;

-- setiap "Simpan" membuat versi baru; versi lama tetap bisa dibuka
CREATE TABLE IF NOT EXISTS project_versions (
  id          BIGSERIAL PRIMARY KEY,
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version     INT NOT NULL,
  data        JSONB NOT NULL,                   -- {net, demand, add, cfg}
  note        TEXT NOT NULL DEFAULT '',
  size_bytes  INT NOT NULL DEFAULT 0,
  created_by  INT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, version)
);

-- hasil simulasi yang disimpan (dari Optimus di peramban, atau dari SUMO asli lewat layanan Python)
CREATE TABLE IF NOT EXISTS runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version         INT NOT NULL,
  engine          TEXT NOT NULL CHECK (engine IN ('sumoweb', 'sumo')),
  note            TEXT NOT NULL DEFAULT '',
  config          JSONB NOT NULL DEFAULT '{}'::jsonb,
  totals          JSONB NOT NULL DEFAULT '{}'::jsonb,   -- CO2, BBM, listrik, jarak, tiba, teleport, ...
  summary         JSONB NOT NULL DEFAULT '[]'::jsonb,   -- deret waktu [t, running, halting, meanSpeed, arrived, co2]
  tripinfo        JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [id, type, depart, duration, routeLength, waitingTime, timeLoss, CO2, fuel, elec]
  detectors       JSONB NOT NULL DEFAULT '[]'::jsonb,
  sim_time        DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_by      INT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS runs_project_idx ON runs(project_id, created_at DESC);

INSERT INTO schema_migrations(version) VALUES (1) ON CONFLICT DO NOTHING;
