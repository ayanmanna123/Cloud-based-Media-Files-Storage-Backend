const supabase = require('../config/supabase');
const imagekit = require('../config/imagekit');
const { AppError, ERROR_CODES } = require('../utils/error');
const { keysToCamel } = require('../utils/caseConverter');
const crypto = require('crypto');

exports.initFileUpload = async (req, res, next) => {
  try {
    const { name, mimeType, sizeBytes, folderId } = req.body;

    if (!name || !mimeType || !sizeBytes) {
      throw new AppError('Missing required file metadata', ERROR_CODES.BAD_REQUEST.status, ERROR_CODES.BAD_REQUEST.code);
    }

    // Generate a unique storage key with strict sanitization (ImageKit replaces special chars with _)
    const uniqueId = crypto.randomUUID();
    const sanitizedName = name.replace(/[^a-zA-Z0-9.\-]/g, '_');
    const storageKey = `user_${req.user.id}/${uniqueId}_${sanitizedName}`;

    // Check for existing file with same name in same folder
    let query = supabase
      .from('files')
      .select('id, name')
      .eq('owner_id', req.user.id)
      .eq('name', name)
      .eq('is_deleted', false);
      
    if (folderId) {
      query = query.eq('folder_id', folderId);
    } else {
      query = query.is('folder_id', null);
    }

    const { data: existingFiles, error: queryError } = await query.limit(1);
    
    if (queryError) {
      console.error("Error querying existing files:", queryError);
    }
    
    const existingFile = existingFiles && existingFiles.length > 0 ? existingFiles[0] : null;
    
    let fileId;
    let isNewVersion = false;

    if (existingFile) {
        fileId = existingFile.id;
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
    
    const { data: file, error: fileError } = await supabase
      .from('files')
      .select('*')
      .eq('id', fileId)
      .eq('owner_id', req.user.id)
      .single();

    if (fileError || !file) {
      throw new AppError('File not found', ERROR_CODES.NOT_FOUND.status, ERROR_CODES.NOT_FOUND.code);
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
