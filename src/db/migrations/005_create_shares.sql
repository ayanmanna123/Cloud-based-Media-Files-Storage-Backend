-- Migration: 005_create_shares
-- Description: Creates the shares table for access control and custom enums

-- Create ENUM types for resource types and roles
-- Note: We use DO block to only create the ENUM if it doesn't already exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'share_resource_type') THEN
        CREATE TYPE share_resource_type AS ENUM ('file', 'folder');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'share_role') THEN
        CREATE TYPE share_role AS ENUM ('viewer', 'editor');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resource_type share_resource_type NOT NULL,
    resource_id UUID NOT NULL,
    grantee_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role share_role NOT NULL,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    -- Ensures a user cannot be granted multiple roles on the exact same resource
    UNIQUE (resource_type, resource_id, grantee_user_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS shares_grantee_user_id_idx ON shares (grantee_user_id);
CREATE INDEX IF NOT EXISTS shares_resource_id_idx ON shares (resource_id);
CREATE INDEX IF NOT EXISTS shares_created_by_idx ON shares (created_by);
