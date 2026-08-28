-- Migration: 015_add_is_hidden_column
-- Description: Adds is_hidden boolean column to files and folders tables to support hiding folders/files.

ALTER TABLE files ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT FALSE;
ALTER TABLE folders ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT FALSE;
