const supabase = require('../config/supabase');
const { AppError, ERROR_CODES } = require('../utils/error');
const { keysToCamel } = require('../utils/caseConverter');

exports.createFolder = async (req, res, next) => {
  try {
    const { name, parentId } = req.body;
    
    if (!name) {
      throw new AppError('Folder name is required', ERROR_CODES.BAD_REQUEST.status, ERROR_CODES.BAD_REQUEST.code);
    }

    const { data, error } = await supabase
      .from('folders')
      .insert([
        {
          name,
          parent_id: parentId || null,
          owner_id: req.user.id,
        },
      ])
      .select()
      .single();

    if (error) {
      throw new AppError(error.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
    }

    res.status(201).json(keysToCamel(data));
  } catch (error) {
    next(error);
  }
};

exports.getFolder = async (req, res, next) => {
  try {
    const { id } = req.params;

    // 1. Get the folder itself
    const { data: folder, error: folderError } = await supabase
      .from('folders')
      .select('*')
      .eq('id', id)
      .eq('owner_id', req.user.id)
      .eq('is_deleted', false)
      .single();

    if (folderError || !folder) {
      throw new AppError('Folder not found', ERROR_CODES.NOT_FOUND.status, ERROR_CODES.NOT_FOUND.code);
    }

    // 2. Get children (subfolders)
    const { data: folders } = await supabase
      .from('folders')
      .select('*')
      .eq('parent_id', id)
      .eq('owner_id', req.user.id)
      .eq('is_deleted', false);

    // 3. Get children (files)
    const { data: files } = await supabase
      .from('files')
      .select('*')
      .eq('folder_id', id)
      .eq('owner_id', req.user.id)
      .eq('is_deleted', false);

    res.status(200).json({
      folder: keysToCamel(folder),
      children: {
        folders: keysToCamel(folders || []),
        files: keysToCamel(files || []),
      },
      path: [] // Path logic would require a recursive CTE query, skipped for brevity in placeholder
    });
  } catch (error) {
    next(error);
  }
};

exports.updateFolder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, parentId } = req.body;

    const updates = {};
    if (name) updates.name = name;
    if (parentId !== undefined) updates.parent_id = parentId;
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('folders')
      .update(updates)
      .eq('id', id)
      .eq('owner_id', req.user.id)
      .select()
      .single();

    if (error || !data) {
      throw new AppError('Folder not found or update failed', ERROR_CODES.NOT_FOUND.status, ERROR_CODES.NOT_FOUND.code);
    }

    res.status(200).json(keysToCamel(data));
  } catch (error) {
    next(error);
  }
};

exports.deleteFolder = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Soft delete
    const { data, error } = await supabase
      .from('folders')
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('owner_id', req.user.id)
      .select()
      .single();

    if (error || !data) {
      throw new AppError('Folder not found or delete failed', ERROR_CODES.NOT_FOUND.status, ERROR_CODES.NOT_FOUND.code);
    }

    res.status(200).json({ status: 'success', message: 'Folder deleted' });
  } catch (error) {
    next(error);
  }
};
