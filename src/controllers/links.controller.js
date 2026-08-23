const supabase = require('../config/supabase');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { AppError, ERROR_CODES } = require('../utils/error');
const { keysToCamel } = require('../utils/caseConverter');

exports.createLinkShare = async (req, res, next) => {
  try {
    const { resourceType, resourceId, expiresAt, password } = req.body;

    if (!resourceType || !resourceId) {
      throw new AppError('Missing resource type or id', ERROR_CODES.BAD_REQUEST.status, ERROR_CODES.BAD_REQUEST.code);
    }

    const token = crypto.randomBytes(16).toString('hex');
    let passwordHash = null;

    if (password) {
      const salt = await bcrypt.genSalt(10);
      passwordHash = await bcrypt.hash(password, salt);
    }

    const { data, error } = await supabase
      .from('link_shares')
      .insert([
        {
          resource_type: resourceType,
          resource_id: resourceId,
          token,
          password_hash: passwordHash,
          expires_at: expiresAt || null,
          created_by: req.user.id,
        },
      ])
      .select()
      .single();

    if (error) {
      throw new AppError(error.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
    }

    const responseData = keysToCamel(data);
    responseData.passwordHash = undefined; // Do not return hash
    res.status(201).json(responseData);
  } catch (error) {
    next(error);
  }
};

exports.getLink = async (req, res, next) => {
  try {
    const { token } = req.params;
    const { password } = req.query; // If password is required, client might send it in query or body

    const { data: link, error } = await supabase
      .from('link_shares')
      .select('*')
      .eq('token', token)
      .single();

    if (error || !link) {
      throw new AppError('Link not found or invalid', ERROR_CODES.NOT_FOUND.status, ERROR_CODES.NOT_FOUND.code);
    }

    // Check expiration
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      throw new AppError('This link has expired', ERROR_CODES.FORBIDDEN.status, ERROR_CODES.FORBIDDEN.code);
    }

    // Check password
    if (link.password_hash) {
      if (!password) {
        throw new AppError('Password required to access this link', ERROR_CODES.UNAUTHORIZED.status, ERROR_CODES.UNAUTHORIZED.code);
      }
      const isMatch = await bcrypt.compare(password, link.password_hash);
      if (!isMatch) {
        throw new AppError('Incorrect password', ERROR_CODES.UNAUTHORIZED.status, ERROR_CODES.UNAUTHORIZED.code);
      }
    }

    // Return the resource info (You might want to join or fetch the actual file/folder data here)
    res.status(200).json({
      resourceType: link.resource_type,
      resourceId: link.resource_id,
      // ... more resource data
    });
  } catch (error) {
    next(error);
  }
};

exports.deleteLinkShare = async (req, res, next) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('link_shares')
      .delete()
      .eq('id', id)
      .eq('created_by', req.user.id);

    if (error) {
      throw new AppError('Failed to delete link', ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
    }

    res.status(200).json({ status: 'success', message: 'Link deleted' });
  } catch (error) {
    next(error);
  }
};
