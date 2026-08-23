-- Migration: 003_create_files
-- Description: Creates the files table

CREATE TABLE IF NOT EXISTS files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    storage_key TEXT UNIQUE NOT NULL,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    folder_id UUID REFERENCES folders(id) ON DELETE CASCADE,
    version_id UUID, -- Pointer to file_versions.id (foreign key to be added after file_versions is created)
    checksum TEXT,
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS files_name_idx ON files (name);
CREATE INDEX IF NOT EXISTS files_owner_id_idx ON files (owner_id);
CREATE INDEX IF NOT EXISTS files_folder_id_idx ON files (folder_id);
