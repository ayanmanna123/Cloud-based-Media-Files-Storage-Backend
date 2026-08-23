-- Migration: 006_create_link_shares
-- Description: Creates the link_shares table for public shareable links

CREATE TABLE IF NOT EXISTS link_shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resource_type share_resource_type NOT NULL, -- Reuses the ENUM from 005_create_shares
    resource_id UUID NOT NULL,
    token TEXT UNIQUE NOT NULL,
    role share_role NOT NULL DEFAULT 'viewer', -- Reuses the ENUM from 005_create_shares
    password_hash TEXT,
    expires_at TIMESTAMPTZ,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS link_shares_token_idx ON link_shares (token);
CREATE INDEX IF NOT EXISTS link_shares_resource_id_idx ON link_shares (resource_id);
CREATE INDEX IF NOT EXISTS link_shares_created_by_idx ON link_shares (created_by);
