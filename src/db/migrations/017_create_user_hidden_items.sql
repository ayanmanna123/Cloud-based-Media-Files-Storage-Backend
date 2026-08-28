-- Migration to create user_hidden_items table for personal hidden items
CREATE TABLE IF NOT EXISTS public.user_hidden_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    resource_type VARCHAR(20) NOT NULL CHECK (resource_type IN ('file', 'folder')),
    resource_id UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT user_hidden_items_unique UNIQUE (user_id, resource_type, resource_id)
);

-- Index for quick lookup of a user's hidden items
CREATE INDEX IF NOT EXISTS user_hidden_items_user_idx ON public.user_hidden_items (user_id);
