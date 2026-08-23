-- Migration: 012_add_reset_password_fields
-- Description: Adds reset_password_token and reset_password_expires columns to users table

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS reset_password_token TEXT,
ADD COLUMN IF NOT EXISTS reset_password_expires TIMESTAMPTZ;
