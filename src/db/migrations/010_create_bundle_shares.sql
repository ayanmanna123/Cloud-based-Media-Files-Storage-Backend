-- Migration: 010_create_bundle_shares
-- Description: Creates the bundle_shares table to allow sharing multiple files under a single public token.

CREATE TABLE IF NOT EXISTS bundle_shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token TEXT UNIQUE NOT NULL,
    file_ids JSONB NOT NULL,
    password_hash TEXT,
    expires_at TIMESTAMPTZ,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS bundle_shares_token_idx ON bundle_shares (token);
CREATE INDEX IF NOT EXISTS bundle_shares_created_by_idx ON bundle_shares (created_by);
