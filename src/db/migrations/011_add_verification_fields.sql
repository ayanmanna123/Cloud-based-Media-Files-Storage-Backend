-- Migration: 011_add_verification_fields
-- Description: Adds is_verified and verification_token columns to users table

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS verification_token TEXT;
