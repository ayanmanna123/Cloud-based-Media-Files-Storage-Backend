const supabase = require('../config/supabase');
const imagekit = require('../config/imagekit');
const telegramStorageService = require('../services/telegramStorage.service');
const { AppError, ERROR_CODES } = require('../utils/error');
const { keysToCamel } = require('../utils/caseConverter');
const crypto = require('crypto');

exports.initFileUpload = async (req, res, next) => {
  try {
    const { name, mimeType, sizeBytes, folderId, targetFileId } = req.body;

    if (!name || !mimeType || !sizeBytes) {
      throw new AppError('Missing required file metadata', ERROR_CODES.BAD_REQUEST.status, ERROR_CODES.BAD_REQUEST.code);
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
        .eq('owner_id', req.user.id)
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
    const storageOwnerId = existingFile ? existingFile.owner_id : req.user.id;
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
            owner_id: req.user.id,
            folder_id: folderId || null,
          }])
          .select()
          .single();

        if (error) {
          throw new AppError(error.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
        }
        fileId = newFile.id;
    }

    // Determine active storage provider
    const provider = process.env.STORAGE_PROVIDER || (telegramStorageService.isConfigured() ? 'telegram' : 'imagekit');

    if (provider === 'telegram') {
      return res.status(200).json({
        fileId: fileId,
        storageKey: storageKey,
        isNewVersion,
        upload: {
          method: 'telegram',
          endpoint: '/api/files/upload-telegram',
        },
      });
    }

    // Default: ImageKit Auth Params for client-side upload
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
    if (file.owner_id !== req.user.id) {
      const { data: shareData } = await supabase
        .from('shares')
        .select('role')
        .eq('resource_type', 'file')
        .eq('resource_id', fileId)
        .eq('grantee_user_id', req.user.id)
        .eq('role', 'editor')
        .single();
        
      if (!shareData) {
        throw new AppError('Unauthorized to update this file', ERROR_CODES.FORBIDDEN.status, ERROR_CODES.FORBIDDEN.code);
      }
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

exports.uploadTelegramFile = async (req, res, next) => {
  try {
    if (!req.file) {
      throw new AppError('No file uploaded', ERROR_CODES.BAD_REQUEST.status, ERROR_CODES.BAD_REQUEST.code);
    }

    const { name, folderId, targetFileId, fileId, isNewVersion: isNewVersionBody } = req.body;
    const fileName = name || req.file.originalname;
    const mimeType = req.file.mimetype;
    const sizeBytes = req.file.size;

    // Upload file buffer to Telegram Channel
    const { fileId: tgFileId, messageId } = await telegramStorageService.uploadFile(
      req.file.buffer,
      fileName,
      mimeType
    );

    const storageKey = `tg:${tgFileId}`;
    let fileRecord;

    const existingId = targetFileId || fileId;

    if (existingId) {
      const { data: existing, error: findError } = await supabase
        .from('files')
        .select('*')
        .eq('id', existingId)
        .eq('is_deleted', false)
        .single();

      if (!findError && existing) {
        fileRecord = existing;
      }
    }

    const isNewVersion = isNewVersionBody === 'true' || Boolean(targetFileId && fileRecord);

    if (isNewVersion && fileRecord) {
      const { data: versions } = await supabase
        .from('file_versions')
        .select('version_number')
        .eq('file_id', fileRecord.id)
        .order('version_number', { ascending: false })
        .limit(1);

      const nextVersion = (versions && versions.length > 0) ? versions[0].version_number + 1 : 2;

      const { data: newVersion, error: vErr } = await supabase
        .from('file_versions')
        .insert([{
          file_id: fileRecord.id,
          version_number: nextVersion,
          storage_key: storageKey,
          size_bytes: sizeBytes,
        }])
        .select('id')
        .single();

      if (vErr) throw new AppError(vErr.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);

      const { data: updatedFile, error: updateErr } = await supabase
        .from('files')
        .update({
          version_id: newVersion.id,
          storage_key: storageKey,
          size_bytes: sizeBytes,
          updated_at: new Date().toISOString(),
        })
        .eq('id', fileRecord.id)
        .select()
        .single();

      if (updateErr) throw new AppError(updateErr.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
      fileRecord = updatedFile;
    } else if (fileRecord) {
      // Update initial file record created during initFileUpload
      const { data: updatedFile, error: updateErr } = await supabase
        .from('files')
        .update({
          storage_key: storageKey,
          mime_type: mimeType,
          size_bytes: sizeBytes,
          updated_at: new Date().toISOString(),
        })
        .eq('id', fileRecord.id)
        .select()
        .single();

      if (updateErr) throw new AppError(updateErr.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
      fileRecord = updatedFile;

      const { data: version, error: vErr } = await supabase
        .from('file_versions')
        .insert([{
          file_id: fileRecord.id,
          version_number: 1,
          storage_key: storageKey,
          size_bytes: sizeBytes,
        }])
        .select('id')
        .single();

      if (!vErr && version) {
        await supabase
          .from('files')
          .update({ version_id: version.id })
          .eq('id', fileRecord.id);
      }
    } else {
      // Fallback: create new file record if init was not called
      const { data: newFile, error: insertErr } = await supabase
        .from('files')
        .insert([{
          name: fileName,
          mime_type: mimeType,
          size_bytes: sizeBytes,
          storage_key: storageKey,
          owner_id: req.user.id,
          folder_id: folderId || null,
        }])
        .select()
        .single();

      if (insertErr) throw new AppError(insertErr.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
      fileRecord = newFile;

      const { data: version, error: vErr } = await supabase
        .from('file_versions')
        .insert([{
          file_id: fileRecord.id,
          version_number: 1,
          storage_key: storageKey,
          size_bytes: sizeBytes,
        }])
        .select('id')
        .single();

      if (!vErr && version) {
        await supabase
          .from('files')
          .update({ version_id: version.id })
          .eq('id', fileRecord.id);
      }
    }


    const signedUrl = await telegramStorageService.getFileUrl(tgFileId);

    res.status(200).json({
      status: 'success',
      file: keysToCamel(fileRecord),
      signedUrl,
    });
  } catch (error) {
    next(error);
  }
};

exports.getFile = async (req, res, next) => {
  try {
    const { id } = req.params;

    const { data: file, error } = await supabase
      .from('files')
      .select('*')
      .eq('id', id)
      .eq('owner_id', req.user.id)
      .eq('is_deleted', false)
      .single();

    if (error || !file) {
      throw new AppError('File not found', ERROR_CODES.NOT_FOUND.status, ERROR_CODES.NOT_FOUND.code);
    }

    let signedUrl;
    if (file.storage_key && file.storage_key.startsWith('tg:')) {
      const tgFileId = file.storage_key.replace(/^tg:/, '');
      signedUrl = await telegramStorageService.getFileUrl(tgFileId);
    } else {
      signedUrl = imagekit.url({
        path: file.storage_key.startsWith('/') ? file.storage_key : '/' + file.storage_key,
        signed: true,
        expireSeconds: 3600, // 1 hour
      });
    }

    res.status(200).json({
      file: keysToCamel(file),
      signedUrl,
    });
  } catch (error) {
    next(error);
  }
};

exports.viewFile = async (req, res, next) => {
  try {
    const { id } = req.params;

    const { data: file, error } = await supabase
      .from('files')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !file) {
      throw new AppError('File not found', ERROR_CODES.NOT_FOUND.status, ERROR_CODES.NOT_FOUND.code);
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    if (file.storage_key && file.storage_key.startsWith('tg:')) {
      const tgFileId = file.storage_key.replace(/^tg:/, '');
      const directUrl = await telegramStorageService.getFileUrl(tgFileId);
      return res.redirect(302, directUrl);
    } else {
      const signedUrl = imagekit.url({
        path: file.storage_key.startsWith('/') ? file.storage_key : '/' + file.storage_key,
        signed: true,
        expireSeconds: 3600,
      });
      return res.redirect(302, signedUrl);
    }

  } catch (error) {
    next(error);
  }
};

exports.updateFile = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, folderId } = req.body;

    const updates = {};
    if (name) updates.name = name;
    if (folderId !== undefined) updates.folder_id = folderId;
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('files')
      .update(updates)
      .eq('id', id)
      .eq('owner_id', req.user.id)
      .select()
      .single();

    if (error || !data) {
      throw new AppError('File not found or update failed', ERROR_CODES.NOT_FOUND.status, ERROR_CODES.NOT_FOUND.code);
    }

    // Log rename/move activity here...

    res.status(200).json(keysToCamel(data));
  } catch (error) {
    next(error);
  }
};

exports.deleteFile = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Soft delete
    const { data, error } = await supabase
      .from('files')
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('owner_id', req.user.id)
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
