-- Migration: 010_add_password_hash
-- Description: Adds a password_hash column to the users table for custom JWT authentication

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS password_hash TEXT;
