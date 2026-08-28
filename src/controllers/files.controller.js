const supabase = require('../config/supabase');
const imagekit = require('../config/imagekit');
const { AppError, ERROR_CODES } = require('../utils/error');
const { keysToCamel } = require('../utils/caseConverter');
const { getPersonalHiddenIds } = require('../utils/hiddenItems');
const crypto = require('crypto');
const getFolderShareRole = async (folderId, userId) => {
  let currentId = folderId;
  let depth = 0;
  
  while (currentId && depth < 20) {
    const { data: folder } = await supabase
      .from('folders')
      .select('owner_id, parent_id')
      .eq('id', currentId)
      .single();
      
    if (!folder) return null;
    if (folder.owner_id === userId) return 'owner';
    
    // Check if directly shared
    const { data: share } = await supabase
      .from('shares')
      .select('role')
      .eq('resource_type', 'folder')
      .eq('resource_id', currentId)
      .eq('grantee_user_id', userId)
      .single();
      
    if (share) return share.role; // 'editor' or 'viewer'
    
    currentId = folder.parent_id;
    depth++;
  }
  
  return null;
};

const checkFolderAccess = async (folderId, userId) => {
  const role = await getFolderShareRole(folderId, userId);
  return role !== null;
};

const checkFileAccess = async (fileId, userId) => {
  const { data: file } = await supabase
    .from('files')
    .select('owner_id, folder_id')
    .eq('id', fileId)
    .single();

  if (!file) return false;
  if (file.owner_id === userId) return true;

  // Check if directly shared
  const { data: share } = await supabase
    .from('shares')
    .select('id')
    .eq('resource_type', 'file')
    .eq('resource_id', fileId)
    .eq('grantee_user_id', userId)
    .single();

  if (share) return true;

  // Check if parent folder is shared
  if (file.folder_id) {
    return await checkFolderAccess(file.folder_id, userId);
  }

  return false;
};

const checkFileEditor = async (fileId, userId) => {
  const { data: file } = await supabase
    .from('files')
    .select('owner_id, folder_id')
    .eq('id', fileId)
    .single();

  if (!file) return false;
  if (file.owner_id === userId) return true;

  // Check if directly shared with editor role
  const { data: share } = await supabase
    .from('shares')
    .select('role')
    .eq('resource_type', 'file')
    .eq('resource_id', fileId)
    .eq('grantee_user_id', userId)
    .eq('role', 'editor')
    .single();

  if (share) return true;

  // Check if parent folder is shared with editor role
  if (file.folder_id) {
    const folderRole = await getFolderShareRole(file.folder_id, userId);
    return folderRole === 'owner' || folderRole === 'editor';
  }

  return false;
};

exports.initFileUpload = async (req, res, next) => {
  try {
    const { name, mimeType, sizeBytes, folderId, targetFileId } = req.body;

    if (!name || !mimeType || !sizeBytes) {
      throw new AppError('Missing required file metadata', ERROR_CODES.BAD_REQUEST.status, ERROR_CODES.BAD_REQUEST.code);
    }

    let fileOwnerId = req.user.id;
    if (folderId) {
      const folderRole = await getFolderShareRole(folderId, req.user.id);
      if (folderRole !== 'owner' && folderRole !== 'editor') {
        throw new AppError('Unauthorized to edit this folder', ERROR_CODES.FORBIDDEN.status, ERROR_CODES.FORBIDDEN.code);
      }
      
      const { data: parentFolder } = await supabase
        .from('folders')
        .select('owner_id')
        .eq('id', folderId)
        .single();
      if (parentFolder) {
        fileOwnerId = parentFolder.owner_id;
      }
    }

    // Generate a unique storage key with strict sanitization (ImageKit replaces special chars with _)
    const uniqueId = crypto.randomUUID();
    const sanitizedName = name.replace(/[^a-zA-Z0-9.\-]/g, '_');
    
    // Check for existing file
    let existingFile = null;
    
    if (targetFileId) {
      const { data: fileData, error: fileError } = await supabase
        .from('files')
        .select('id, name, owner_id')
        .eq('id', targetFileId)
        .eq('is_deleted', false)
        .single();
        
      if (fileError) console.error("Error finding targetFileId:", fileError);
      
      if (fileData) {
        if (fileData.owner_id === req.user.id) {
          existingFile = fileData;
        } else {
          // Check for editor permission in shares
          const { data: shareData } = await supabase
            .from('shares')
            .select('role')
            .eq('resource_type', 'file')
            .eq('resource_id', targetFileId)
            .eq('grantee_user_id', req.user.id)
            .eq('role', 'editor')
            .single();
            
          if (shareData) {
            existingFile = fileData;
          } else {
            // Might be a folder share granting permission, but for simplicity we rely on file share here. 
            // Better to throw if unauthorized, but to match original logic, let it proceed to create new if not found.
            throw new AppError('Unauthorized to edit this file', ERROR_CODES.FORBIDDEN.status, ERROR_CODES.FORBIDDEN.code);
          }
        }
      }
    } else {
      let query = supabase
        .from('files')
        .select('id, name, owner_id')
        .eq('owner_id', fileOwnerId)
        .eq('name', name)
        .eq('is_deleted', false);
        
      if (folderId) {
        query = query.eq('folder_id', folderId);
      } else {
        query = query.is('folder_id', null);
      }

      const { data: existingFiles, error: queryError } = await query.limit(1);
      if (queryError) console.error("Error querying existing files:", queryError);
      existingFile = existingFiles && existingFiles.length > 0 ? existingFiles[0] : null;
    }
    
    // We use the owner's ID for the storage key to keep files grouped by original owner
    const storageOwnerId = existingFile ? existingFile.owner_id : fileOwnerId;
    const storageKey = `user_${storageOwnerId}/${uniqueId}_${sanitizedName}`;
    
    const existingFileId = existingFile ? existingFile.id : null;
    let fileId;
    let isNewVersion = false;

    if (existingFileId) {
        fileId = existingFileId;
        isNewVersion = true;
    } else {
        const { data: newFile, error } = await supabase
          .from('files')
          .insert([{
            name,
            mime_type: mimeType,
            size_bytes: sizeBytes,
            storage_key: storageKey,
            owner_id: fileOwnerId,
            folder_id: folderId || null,
          }])
          .select()
          .single();

        if (error) {
          throw new AppError(error.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
        }
        fileId = newFile.id;
    }

    // 2. Generate ImageKit Auth Params for client-side upload
    const authParams = imagekit.getAuthenticationParameters();

    res.status(200).json({
      fileId: fileId,
      storageKey: storageKey,
      isNewVersion,
      upload: {
        method: 'imagekit',
        auth: authParams, // { token, expire, signature }
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.completeFileUpload = async (req, res, next) => {
  try {
    const { fileId, isNewVersion, storageKey, sizeBytes } = req.body;
    
    // Verify file exists and user has permission
    const { data: file, error: fileError } = await supabase
      .from('files')
      .select('*')
      .eq('id', fileId)
      .single();

    if (fileError || !file) {
      throw new AppError('File not found', ERROR_CODES.NOT_FOUND.status, ERROR_CODES.NOT_FOUND.code);
    }
    
    // Check permission
    const isEditor = await checkFileEditor(fileId, req.user.id);
    if (!isEditor) {
      throw new AppError('Unauthorized to update this file', ERROR_CODES.FORBIDDEN.status, ERROR_CODES.FORBIDDEN.code);
    }

    if (isNewVersion) {
      // Get max version number
      const { data: versions } = await supabase
        .from('file_versions')
        .select('version_number')
        .eq('file_id', file.id)
        .order('version_number', { ascending: false })
        .limit(1);
        
      const nextVersion = (versions && versions.length > 0) ? versions[0].version_number + 1 : 2;

      const { data: newVersion, error: versionError } = await supabase
        .from('file_versions')
        .insert([{
          file_id: file.id,
          version_number: nextVersion,
          storage_key: storageKey,
          size_bytes: sizeBytes,
        }])
        .select('id')
        .single();

      if (versionError) {
        throw new AppError(versionError.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
      }

      await supabase
        .from('files')
        .update({ 
          version_id: newVersion.id,
          storage_key: storageKey,
          size_bytes: sizeBytes,
          updated_at: new Date().toISOString()
        })
        .eq('id', file.id);

    } else {
      // Create initial file version
      const { data: version, error: versionError } = await supabase
        .from('file_versions')
        .insert([{
            file_id: file.id,
            version_number: 1,
            storage_key: file.storage_key,
            size_bytes: file.size_bytes,
        }])
        .select('id')
        .single();

      if (versionError) {
        throw new AppError(versionError.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
      }

      await supabase
        .from('files')
        .update({ version_id: version.id })
        .eq('id', file.id);
    }

    res.status(200).json({ status: 'success', message: 'Upload completed' });
  } catch (error) {
    next(error);
  }
};

exports.getFile = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Verify user has access to this file (owner, directly shared, or parent folder shared)
    const hasAccess = await checkFileAccess(id, req.user.id);
    if (!hasAccess) {
      throw new AppError('File not found', ERROR_CODES.NOT_FOUND.status, ERROR_CODES.NOT_FOUND.code);
    }

    const { data: file, error } = await supabase
      .from('files')
      .select('*')
      .eq('id', id)
      .eq('is_deleted', false)
      .single();

    if (error || !file) {
      throw new AppError('File not found', ERROR_CODES.NOT_FOUND.status, ERROR_CODES.NOT_FOUND.code);
    }

    // Generate signed URL via ImageKit if it's private, or just standard URL
    // Depending on ImageKit config, you can sign it
    const signedUrl = imagekit.url({
      path: file.storage_key.startsWith('/') ? file.storage_key : '/' + file.storage_key,
      signed: true,
      expireSeconds: 3600, // 1 hour
    });

    res.status(200).json({
      file: keysToCamel(file),
      signedUrl,
    });
  } catch (error) {
    next(error);
  }
};

exports.updateFile = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, folderId, isHidden } = req.body;

    const hasAccess = await checkFileAccess(id, req.user.id);
    if (!hasAccess) {
      throw new AppError('File not found or unauthorized', ERROR_CODES.FORBIDDEN.status, ERROR_CODES.FORBIDDEN.code);
    }

    if (name || folderId !== undefined) {
      const isEditor = await checkFileEditor(id, req.user.id);
      if (!isEditor) {
        throw new AppError('File not found or unauthorized', ERROR_CODES.FORBIDDEN.status, ERROR_CODES.FORBIDDEN.code);
      }
    }

    if (folderId) {
      const folderRole = await getFolderShareRole(folderId, req.user.id);
      if (folderRole !== 'owner' && folderRole !== 'editor') {
        throw new AppError('Unauthorized to edit target folder', ERROR_CODES.FORBIDDEN.status, ERROR_CODES.FORBIDDEN.code);
      }
    }

    if (isHidden !== undefined) {
      if (isHidden) {
        const { error: upsertErr } = await supabase
          .from('user_hidden_items')
          .upsert([{ user_id: req.user.id, resource_type: 'file', resource_id: id }]);
        if (upsertErr) {
          console.error("user_hidden_items upsert failed, updating legacy is_hidden column:", upsertErr.message);
          await supabase.from('files').update({ is_hidden: true }).eq('id', id);
        }
      } else {
        await supabase
          .from('user_hidden_items')
          .delete()
          .eq('user_id', req.user.id)
          .eq('resource_type', 'file')
          .eq('resource_id', id);
        await supabase.from('files').update({ is_hidden: false }).eq('id', id);
      }
    }

    let data = null;
    if (name || folderId !== undefined) {
      const updates = {};
      if (name) updates.name = name;
      if (folderId !== undefined) updates.folder_id = folderId;
      updates.updated_at = new Date().toISOString();

      const { data: updatedData, error } = await supabase
        .from('files')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error || !updatedData) {
        throw new AppError('File update failed', ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
      }
      data = updatedData;
    } else {
      const { data: existingData } = await supabase
        .from('files')
        .select('*')
        .eq('id', id)
        .single();
      data = existingData;
    }

    // Log rename/move activity here...

    const { hiddenFileIds } = await getPersonalHiddenIds(req.user.id);
    const result = {
      ...data,
      isHidden: isHidden !== undefined ? isHidden : hiddenFileIds.includes(data?.id)
    };

    res.status(200).json(keysToCamel(result));
  } catch (error) {
    next(error);
  }
};

exports.deleteFile = async (req, res, next) => {
  try {
    const { id } = req.params;

    const isEditor = await checkFileEditor(id, req.user.id);
    if (!isEditor) {
      throw new AppError('File not found or unauthorized', ERROR_CODES.FORBIDDEN.status, ERROR_CODES.FORBIDDEN.code);
    }

    // Soft delete
    const { data, error } = await supabase
      .from('files')
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      throw new AppError('File not found or delete failed', ERROR_CODES.NOT_FOUND.status, ERROR_CODES.NOT_FOUND.code);
    }

    // Log delete activity here...

    res.status(200).json({ status: 'success', message: 'File deleted' });
  } catch (error) {
    next(error);
  }
};

exports.getFileVersions = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Verify ownership
    const { data: file, error: fileError } = await supabase
      .from('files')
      .select('id')
      .eq('id', id)
      .eq('owner_id', req.user.id)
      .single();

    if (fileError || !file) {
      throw new AppError('File not found', ERROR_CODES.NOT_FOUND.status, ERROR_CODES.NOT_FOUND.code);
    }

    const { data: versions, error: versionError } = await supabase
      .from('file_versions')
      .select('*')
      .eq('file_id', id)
      .order('version_number', { ascending: false });

    if (versionError) {
      throw new AppError(versionError.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
    }

    res.status(200).json(keysToCamel(versions));
  } catch (error) {
    next(error);
  }
};

exports.restoreFileVersion = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { versionId } = req.body;

    if (!versionId) {
      throw new AppError('Version ID is required', ERROR_CODES.BAD_REQUEST.status, ERROR_CODES.BAD_REQUEST.code);
    }

    // Verify ownership
    const { data: file, error: fileError } = await supabase
      .from('files')
      .select('id')
      .eq('id', id)
      .eq('owner_id', req.user.id)
      .single();

    if (fileError || !file) {
      throw new AppError('File not found', ERROR_CODES.NOT_FOUND.status, ERROR_CODES.NOT_FOUND.code);
    }

    // Get the version details
    const { data: version, error: versionError } = await supabase
      .from('file_versions')
      .select('*')
      .eq('id', versionId)
      .eq('file_id', id)
      .single();

    if (versionError || !version) {
      throw new AppError('Version not found', ERROR_CODES.NOT_FOUND.status, ERROR_CODES.NOT_FOUND.code);
    }

    // Update the pointer
    const { error: updateError } = await supabase
      .from('files')
      .update({
        version_id: version.id,
        storage_key: version.storage_key,
        size_bytes: version.size_bytes,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (updateError) {
      throw new AppError(updateError.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
    }

    res.status(200).json({ status: 'success', message: 'Version restored successfully' });
  } catch (error) {
    next(error);
  }
};

exports.getRecentFiles = async (req, res, next) => {
  try {
    const { data: files, error } = await supabase
      .from('files')
      .select('*')
      .eq('owner_id', req.user.id)
      .eq('is_deleted', false)
      .order('updated_at', { ascending: false })
      .limit(50);

    if (error) {
      throw new AppError(error.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
    }

    res.status(200).json(keysToCamel(files));
  } catch (error) {
    next(error);
  }
};

exports.copyFile = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { folderId } = req.body; // target folder id

    // Verify ownership and get file
    const { data: file, error: fileError } = await supabase
      .from('files')
      .select('*')
      .eq('id', id)
      .eq('owner_id', req.user.id)
      .eq('is_deleted', false)
      .single();

    if (fileError || !file) {
      throw new AppError('File not found', ERROR_CODES.NOT_FOUND.status, ERROR_CODES.NOT_FOUND.code);
    }

    // Check for name collision in target folder
    let query = supabase
      .from('files')
      .select('name')
      .eq('owner_id', req.user.id)
      .eq('is_deleted', false);
      
    if (folderId) {
      query = query.eq('folder_id', folderId);
    } else {
      query = query.is('folder_id', null);
    }

    const { data: existingFiles } = await query;
    const existingNames = new Set((existingFiles || []).map(f => f.name));

    let newName = file.name;
    let counter = 1;
    while (existingNames.has(newName)) {
      const extIndex = file.name.lastIndexOf('.');
      if (extIndex > -1) {
        const namePart = file.name.substring(0, extIndex);
        const extPart = file.name.substring(extIndex);
        newName = `${namePart} (Copy ${counter})${extPart}`;
      } else {
        newName = `${file.name} (Copy ${counter})`;
      }
      counter++;
    }

    // Insert new file record pointing to the same storage_key
    const { data: newFile, error: insertError } = await supabase
      .from('files')
      .insert([{
        name: newName,
        mime_type: file.mime_type,
        size_bytes: file.size_bytes,
        storage_key: file.storage_key,
        owner_id: req.user.id,
        folder_id: folderId || null,
      }])
      .select()
      .single();

    if (insertError) {
      throw new AppError(insertError.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
    }

    // Create initial file version for the copy
    const { data: version, error: versionError } = await supabase
      .from('file_versions')
      .insert([{
        file_id: newFile.id,
        version_number: 1,
        storage_key: file.storage_key,
        size_bytes: file.size_bytes,
      }])
      .select('id')
      .single();

    if (!versionError && version) {
      await supabase
        .from('files')
        .update({ version_id: version.id })
        .eq('id', newFile.id);
    }

    res.status(200).json(keysToCamel(newFile));
  } catch (error) {
    next(error);
  }
};
