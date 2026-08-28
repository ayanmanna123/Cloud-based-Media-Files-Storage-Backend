-- Migration: 016_add_secret_code_column
-- Description: Adds secret_code text column to the users table to store their secret passcode.

ALTER TABLE users ADD COLUMN IF NOT EXISTS secret_code TEXT DEFAULT NULL;
