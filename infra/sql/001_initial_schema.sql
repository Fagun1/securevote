-- SecureVote AI — initial schema for Neon PostgreSQL
-- Apply with: psql "$DATABASE_URL" -f infra/sql/001_initial_schema.sql

BEGIN;

-- Roles: voter | admin | super_admin
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'voter' CHECK (role IN ('voter', 'admin', 'super_admin')),
  has_voted BOOLEAN NOT NULL DEFAULT FALSE,
  face_encoding JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_email_lower ON users (lower(email));

CREATE TABLE candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  party TEXT NOT NULL DEFAULT '',
  vote_count INTEGER NOT NULL DEFAULT 0 CHECK (vote_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_candidates_name ON candidates (name);

-- At most one active election row (application may also enforce)
CREATE TABLE election (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT election_time_order CHECK (end_time > start_time)
);

-- Only one row may be "active" at a time (singleton pattern for current election window)
CREATE UNIQUE INDEX election_one_active ON election ((TRUE)) WHERE is_active = TRUE;

-- One vote per user; encrypted_vote stores AES-GCM payload (e.g. base64 JSON: iv + ciphertext)
CREATE TABLE votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  candidate_id UUID NOT NULL REFERENCES candidates (id) ON DELETE RESTRICT,
  encrypted_vote TEXT NOT NULL,
  ip INET,
  "timestamp" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT votes_one_per_user UNIQUE (user_id)
);

CREATE INDEX idx_votes_candidate ON votes (candidate_id);
CREATE INDEX idx_votes_ip ON votes (ip);
CREATE INDEX idx_votes_timestamp ON votes ("timestamp");

-- Blockchain blocks persisted in Neon; "index" is the block height (0-based or 1-based — app defines)
CREATE TABLE blockchain (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "index" INTEGER NOT NULL,
  "timestamp" TIMESTAMPTZ NOT NULL DEFAULT now(),
  voter_hash TEXT NOT NULL,
  candidate_id UUID NOT NULL REFERENCES candidates (id) ON DELETE RESTRICT,
  previous_hash TEXT NOT NULL,
  hash TEXT NOT NULL,
  CONSTRAINT blockchain_index_unique UNIQUE ("index")
);

CREATE INDEX idx_blockchain_voter_hash ON blockchain (voter_hash);
CREATE INDEX idx_blockchain_candidate ON blockchain (candidate_id);

-- Audit / security logs (login, voting, suspicious activity)
CREATE TABLE logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  ip INET,
  "timestamp" TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB
);

CREATE INDEX idx_logs_user_time ON logs (user_id, "timestamp");
CREATE INDEX idx_logs_action ON logs (action);
CREATE INDEX idx_logs_time ON logs ("timestamp");

COMMIT;
