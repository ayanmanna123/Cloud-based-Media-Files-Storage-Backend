const supabase = require('../config/supabase');
const { AppError, ERROR_CODES } = require('../utils/error');
const { keysToCamel } = require('../utils/caseConverter');

exports.search = async (req, res, next) => {
  try {
    const { q, type, starred } = req.query;
    // Basic search implementation. 
    // If using the GIN index for full-text search on files, we would use `.textSearch('name', q)`
    // Here we use ilike for simplicity across both files and folders

    let results = [];

    if (!type || type === 'file') {
      let query = supabase.from('files').select('*').eq('owner_id', req.user.id).eq('is_deleted', false);
      if (q) query = query.ilike('name', `%${q}%`);
      const { data: files } = await query;
      if (files) results = results.concat(files.map(f => ({ ...f, type: 'file' })));
    }

    if (!type || type === 'folder') {
      let query = supabase.from('folders').select('*').eq('owner_id', req.user.id).eq('is_deleted', false);
      if (q) query = query.ilike('name', `%${q}%`);
      const { data: folders } = await query;
      if (folders) results = results.concat(folders.map(f => ({ ...f, type: 'folder' })));
    }

    // Filter by starred if requested
    if (starred === 'true') {
      const { data: stars } = await supabase.from('stars').select('*').eq('user_id', req.user.id);
      const starredItems = stars.map(s => `${s.resource_type}_${s.resource_id}`);
      results = results.filter(r => starredItems.includes(`${r.type}_${r.id}`));
    }

    res.status(200).json(keysToCamel(results));
  } catch (error) {
    next(error);
  }
};

exports.addStar = async (req, res, next) => {
  try {
    const { resourceType, resourceId } = req.body;

    if (!resourceType || !resourceId) {
      throw new AppError('Missing resource type or id', ERROR_CODES.BAD_REQUEST.status, ERROR_CODES.BAD_REQUEST.code);
    }

    const { data, error } = await supabase
      .from('stars')
      .insert([
        {
          user_id: req.user.id,
          resource_type: resourceType,
          resource_id: resourceId,
        },
      ])
      .select()
      .single();

    // Ignore unique constraint error if already starred
    if (error && error.code !== '23505') {
      throw new AppError(error.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
    }

    res.status(200).json({ status: 'success', message: 'Resource starred' });
  } catch (error) {
    next(error);
  }
};

exports.removeStar = async (req, res, next) => {
  try {
    const { resourceType, resourceId } = req.body;

    await supabase
      .from('stars')
      .delete()
      .eq('user_id', req.user.id)
      .eq('resource_type', resourceType)
      .eq('resource_id', resourceId);

    res.status(200).json({ status: 'success', message: 'Star removed' });
  } catch (error) {
    next(error);
  }
};

exports.getTrash = async (req, res, next) => {
  try {
    const { data: files } = await supabase.from('files').select('*').eq('owner_id', req.user.id).eq('is_deleted', true);
    const { data: folders } = await supabase.from('folders').select('*').eq('owner_id', req.user.id).eq('is_deleted', true);

    const trashed = [
      ...(files || []).map(f => ({ ...f, type: 'file' })),
      ...(folders || []).map(f => ({ ...f, type: 'folder' }))
    ];

    res.status(200).json(keysToCamel(trashed));
  } catch (error) {
    next(error);
  }
};

exports.restoreTrash = async (req, res, next) => {
  try {
    const { resourceType, resourceId } = req.body;

    if (!resourceType || !resourceId) {
      throw new AppError('Missing resource type or id', ERROR_CODES.BAD_REQUEST.status, ERROR_CODES.BAD_REQUEST.code);
    }

    const table = resourceType === 'file' ? 'files' : 'folders';

    const { error } = await supabase
      .from(table)
      .update({ is_deleted: false, updated_at: new Date().toISOString() })
      .eq('id', resourceId)
      .eq('owner_id', req.user.id);

    if (error) {
      throw new AppError(error.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
    }

    res.status(200).json({ status: 'success', message: 'Resource restored' });
  } catch (error) {
    next(error);
  }
};
