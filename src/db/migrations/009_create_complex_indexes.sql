-- Migration: 009_create_complex_indexes
-- Description: Creates composite and full-text search indexes for query optimization

-- 1. Composite indexes for fast filtering by user and name at the same time
CREATE INDEX IF NOT EXISTS files_owner_name_idx ON files (owner_id, name);
CREATE INDEX IF NOT EXISTS folders_owner_name_idx ON folders (owner_id, name);

-- 2. GIN Index for Full-Text Search on file names
-- This allows highly optimized searches like finding all files containing the word "holiday"
CREATE INDEX IF NOT EXISTS files_name_gin_idx ON files USING GIN (to_tsvector('simple', name));

-- 3. Ordered index for the activity feed (fetching the most recent activities first)
CREATE INDEX IF NOT EXISTS activities_created_at_desc_idx ON activities (created_at DESC);

-- 4. Composite index to quickly find all shares for a specific file or folder
CREATE INDEX IF NOT EXISTS shares_resource_idx ON shares (resource_type, resource_id);

-- 5. Link shares token index (We already added this during table creation, but including here just in case)
CREATE INDEX IF NOT EXISTS link_shares_token_idx ON link_shares (token);
