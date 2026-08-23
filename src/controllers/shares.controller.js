const supabase = require('../config/supabase');
const { AppError, ERROR_CODES } = require('../utils/error');
const { keysToCamel } = require('../utils/caseConverter');

exports.createShare = async (req, res, next) => {
  try {
    const { resourceType, resourceId, granteeUserId, role } = req.body;

    if (!resourceType || !resourceId || !granteeUserId || !role) {
      throw new AppError('Missing required share parameters', ERROR_CODES.BAD_REQUEST.status, ERROR_CODES.BAD_REQUEST.code);
    }

    // Insert share
    const { data, error } = await supabase
      .from('shares')
      .insert([
        {
          resource_type: resourceType,
          resource_id: resourceId,
          grantee_user_id: granteeUserId,
          role,
          created_by: req.user.id,
        },
      ])
      .select()
      .single();

    if (error) {
      if (error.code === '23505') { // Unique violation
        throw new AppError('This user already has access to this resource', ERROR_CODES.CONFLICT.status, ERROR_CODES.CONFLICT.code);
      }
      throw new AppError(error.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
    }

    res.status(201).json(keysToCamel(data));
  } catch (error) {
    next(error);
  }
};

exports.getShares = async (req, res, next) => {
  try {
    const { resourceType, resourceId } = req.params;

    const { data, error } = await supabase
      .from('shares')
      .select('*, grantee:users(id, email, name)')
      .eq('resource_type', resourceType)
      .eq('resource_id', resourceId);

    if (error) {
      throw new AppError(error.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
    }

    res.status(200).json(keysToCamel(data));
  } catch (error) {
    next(error);
  }
};

exports.deleteShare = async (req, res, next) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('shares')
      .delete()
      .eq('id', id);

    if (error) {
      throw new AppError('Failed to delete share', ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
    }

    res.status(200).json({ status: 'success', message: 'Share removed' });
  } catch (error) {
    next(error);
  }
};
