const supabase = require('../config/supabase');
const { AppError, ERROR_CODES } = require('./error');

// 50 MB limit in bytes
const STORAGE_LIMIT_BYTES = 50 * 1024 * 1024;

/**
 * Calculates total storage used by a user (including file version history)
 * @param {string} userId - User UUID
 * @returns {Promise<number>} - Total storage used in bytes
 */
const getUserStorageUsed = async (userId) => {
  if (!userId) return 0;

  const { data: files, error: filesError } = await supabase
    .from('files')
    .select('id, size_bytes')
    .eq('owner_id', userId);

  if (filesError) {
    console.error('Supabase error fetching files for storage calculation:', filesError);
  }

  if (!filesError && files && files.length > 0) {
    const fileIds = files.map(f => f.id);
    const { data: versions, error: versionsError } = await supabase
      .from('file_versions')
      .select('file_id, size_bytes')
      .in('file_id', fileIds);

    if (versionsError) {
      console.error('Supabase error fetching file_versions for storage calculation:', versionsError);
    }

    const versionsByFile = {};
    if (!versionsError && versions) {
      for (const v of versions) {
        if (!versionsByFile[v.file_id]) versionsByFile[v.file_id] = [];
        versionsByFile[v.file_id].push(v);
      }
    }

    return files.reduce((acc, file) => {
      const fileVersions = versionsByFile[file.id];
      if (fileVersions && fileVersions.length > 0) {
        return acc + fileVersions.reduce((vAcc, v) => vAcc + (Number(v.size_bytes) || 0), 0);
      }
      return acc + (Number(file.size_bytes) || 0);
    }, 0);
  }

  return 0;
};

/**
 * Validates that adding incomingSizeBytes to user's storage won't exceed 50 MB
 * @param {string} userId - User UUID
 * @param {number} incomingSizeBytes - Size of incoming upload or copy in bytes
 */
const checkStorageQuota = async (userId, incomingSizeBytes = 0) => {
  const storageUsed = await getUserStorageUsed(userId);
  const incoming = Number(incomingSizeBytes) || 0;
  
  if (storageUsed + incoming > STORAGE_LIMIT_BYTES) {
    throw new AppError(
      'Storage limit of 50 MB exceeded. Please delete existing files to upload more.',
      ERROR_CODES.BAD_REQUEST.status,
      ERROR_CODES.BAD_REQUEST.code
    );
  }

  return storageUsed;
};

module.exports = {
  STORAGE_LIMIT_BYTES,
  getUserStorageUsed,
  checkStorageQuota
};
