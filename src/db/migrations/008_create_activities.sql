-- Migration: 008_create_activities
-- Description: Creates the activities table for logging user actions (audit trail)

-- Create ENUM type for activity actions
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'activity_action') THEN
        CREATE TYPE activity_action AS ENUM ('upload', 'rename', 'delete', 'restore', 'move', 'share', 'download');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action activity_action NOT NULL,
    resource_type share_resource_type NOT NULL, -- Reuses the ENUM from 005_create_shares
    resource_id UUID NOT NULL,
    context JSONB, -- Flexible JSON object to store any extra info (e.g. { "old_name": "...", "new_name": "..." })
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS activities_actor_id_idx ON activities (actor_id);
-- The prompt explicitly requested an index on created_at for chronologically fetching the activity feed
CREATE INDEX IF NOT EXISTS activities_created_at_idx ON activities (created_at);
