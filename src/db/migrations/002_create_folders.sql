-- Migration: 002_create_folders
-- Description: Creates the folders table with self-referencing and user relationship

CREATE TABLE IF NOT EXISTS folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES folders(id) ON DELETE CASCADE,
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance on frequently queried columns
CREATE INDEX IF NOT EXISTS folders_name_idx ON folders (name);
CREATE INDEX IF NOT EXISTS folders_owner_id_idx ON folders (owner_id);
CREATE INDEX IF NOT EXISTS folders_parent_id_idx ON folders (parent_id);
