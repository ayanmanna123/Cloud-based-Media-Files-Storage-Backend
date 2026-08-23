-- Migration: 004_create_file_versions
-- Description: Creates the file_versions table and updates the files table with the missing foreign key

CREATE TABLE IF NOT EXISTS file_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    version_number INT NOT NULL,
    storage_key TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    checksum TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for performance
CREATE INDEX IF NOT EXISTS file_versions_file_id_idx ON file_versions (file_id);

-- Now that file_versions exists, we can safely add the strict foreign key to the files table
ALTER TABLE files 
ADD CONSTRAINT fk_files_version_id 
FOREIGN KEY (version_id) 
REFERENCES file_versions(id) 
ON DELETE SET NULL;
