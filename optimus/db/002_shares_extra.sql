-- Optimus skema versi 2: data tambahan hasil simulasi, berbagi proyek, tautan publik

ALTER TABLE runs ADD COLUMN IF NOT EXISTS extra JSONB NOT NULL DEFAULT '{}'::jsonb;   -- PKJI, pejalan kaki, halte

-- berbagi proyek ke pengguna lain: view = lihat & jalankan, edit = juga simpan versi baru
CREATE TABLE IF NOT EXISTS project_shares (
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     INT  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('view', 'edit')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS project_shares_user_idx ON project_shares(user_id);

-- tautan publik hanya-baca (token acak; NULL = tidak dibagikan)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS public_token TEXT UNIQUE;

INSERT INTO schema_migrations(version) VALUES (2) ON CONFLICT DO NOTHING;
