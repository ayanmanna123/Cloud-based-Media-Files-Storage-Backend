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

    // 1. Create DB entry for the file (status can be considered 'pending' until complete is called, 
    // though we don't have a status column, we can just insert it)
    const { data: file, error } = await supabase
      .from('files')
      .insert([
        {
          name,
          mime_type: mimeType,
          size_bytes: sizeBytes,
          storage_key: storageKey,
          owner_id: req.user.id,
          folder_id: folderId || null,
        },
      ])
      .select()
      .single();

    if (error) {
      throw new AppError(error.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
    }

    // 2. Generate ImageKit Auth Params for client-side upload
    const authParams = imagekit.getAuthenticationParameters();

    res.status(200).json({
      fileId: file.id,
      storageKey: storageKey,
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
    const { fileId } = req.body;
    // Client can pass ImageKit fileId or tags if needed, but mainly we just mark the DB as complete 
    // by creating the first file_version
    
    const { data: file, error: fileError } = await supabase
      .from('files')
      .select('*')
      .eq('id', fileId)
      .eq('owner_id', req.user.id)
      .single();

    if (fileError || !file) {
      throw new AppError('File not found', ERROR_CODES.NOT_FOUND.status, ERROR_CODES.NOT_FOUND.code);
    }

    // Create initial file version
    const { data: version, error: versionError } = await supabase
      .from('file_versions')
      .insert([
        {
          file_id: file.id,
          version_number: 1,
          storage_key: file.storage_key,
          size_bytes: file.size_bytes,
        }
      ])
      .select('id')
      .single();

    if (versionError) {
      throw new AppError(versionError.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
    }

    // Update file with version_id
    await supabase
      .from('files')
      .update({ version_id: version.id })
      .eq('id', file.id);

    // Optional: trigger background preview job here

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

    res.status(200).json({ status: 'success', message: 'File soft deleted' });
  } catch (error) {
    next(error);
  }
};
