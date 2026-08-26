-- Migration: 014_remove_storage_key_unique
-- Description: Removes the UNIQUE constraint from storage_key on files and file_versions so that files can be easily copied without duplicating physical assets in ImageKit.

ALTER TABLE files DROP CONSTRAINT IF EXISTS files_storage_key_key;
ALTER TABLE file_versions DROP CONSTRAINT IF EXISTS file_versions_storage_key_key;
