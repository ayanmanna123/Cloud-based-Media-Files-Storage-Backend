-- Migration: 007_create_stars
-- Description: Creates the stars table to allow users to favorite files or folders

CREATE TABLE IF NOT EXISTS stars (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    resource_type share_resource_type NOT NULL, -- Reuses the ENUM from 005_create_shares
    resource_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    -- Composite Primary Key ensures a user can only star a specific resource once
    PRIMARY KEY (user_id, resource_type, resource_id)
);

-- Index to quickly fetch all starred items for a specific user
CREATE INDEX IF NOT EXISTS stars_user_id_idx ON stars (user_id);
