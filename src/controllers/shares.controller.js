const supabase = require('../config/supabase');
const { AppError, ERROR_CODES } = require('../utils/error');
const { keysToCamel } = require('../utils/caseConverter');
const { sendShareEmail } = require('../utils/email');

const getFolderMetrics = (folderId, allFolders, allFiles) => {
  const directSubfolders = allFolders.filter(f => f.parent_id === folderId && !f.is_deleted && !f.is_hidden);
  
  const getAllDescendantFolderIds = (id) => {
    let ids = [];
    const children = allFolders.filter(f => f.parent_id === id && !f.is_deleted && !f.is_hidden);
    for (const child of children) {
      ids.push(child.id);
      ids = ids.concat(getAllDescendantFolderIds(child.id));
    }
    return ids;
  };
  
  const allDescendantFolderIds = [folderId, ...getAllDescendantFolderIds(folderId)];
  const allNestedFiles = allFiles.filter(f => allDescendantFolderIds.includes(f.folder_id));
  
  const fileCount = allNestedFiles.length;
  const totalSize = allNestedFiles.reduce((sum, f) => sum + (f.size_bytes || 0), 0);
  const folderCount = directSubfolders.length;

  return { fileCount, folderCount, totalSize };
};

exports.createShare = async (req, res, next) => {
  try {
    const { resourceType, resourceId, email, role, message } = req.body;

    if (!resourceType || !resourceId || !email || !role) {
      throw new AppError('Missing required share parameters', ERROR_CODES.BAD_REQUEST.status, ERROR_CODES.BAD_REQUEST.code);
    }

    // Lookup grantee user by email
    const { data: granteeUser, error: userError } = await supabase
      .from('users')
      .select('id, name')
      .eq('email', email)
      .single();

    if (userError || !granteeUser) {
      throw new AppError('No user found with that email address', ERROR_CODES.NOT_FOUND.status, ERROR_CODES.NOT_FOUND.code);
    }

    // Fetch the resource name and sharer name for the email
    const { data: sharer } = await supabase.from('users').select('name').eq('id', req.user.id).single();
    let resourceName = 'a file';
    if (resourceType === 'folder') {
      const { data: f } = await supabase.from('folders').select('name').eq('id', resourceId).single();
      if (f) resourceName = f.name;
    } else {
      const { data: f } = await supabase.from('files').select('name').eq('id', resourceId).single();
      if (f) resourceName = f.name;
    }

    // Insert share
    const { data, error } = await supabase
      .from('shares')
      .insert([
        {
          resource_type: resourceType,
          resource_id: resourceId,
          grantee_user_id: granteeUser.id,
          role,
          created_by: req.user.id,
        },
      ])
      .select('*, grantee:users!grantee_user_id(id, email, name)')
      .single();

    if (error) {
      if (error.code === '23505') { // Unique violation
        throw new AppError('This user already has access to this resource', ERROR_CODES.CONFLICT.status, ERROR_CODES.CONFLICT.code);
      }
      throw new AppError(error.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
    }

    // Send email notification (non-blocking)
    sendShareEmail(email, sharer?.name || 'Someone', resourceName, role, message).catch(console.error);

    res.status(201).json(keysToCamel(data));
  } catch (error) {
    next(error);
  }
};

exports.getSharedWithMe = async (req, res, next) => {
  try {
    const { data: shares, error } = await supabase
      .from('shares')
      .select('resource_type, resource_id, role, created_by:users!shares_created_by_fkey(id, name, email)')
      .eq('grantee_user_id', req.user.id);
    
    if (error) throw new AppError(error.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);

    const folderIds = shares.filter(s => s.resource_type === 'folder').map(s => s.resource_id);
    const fileIds = shares.filter(s => s.resource_type === 'file').map(s => s.resource_id);

    let folders = [];
    let files = [];

    if (folderIds.length > 0) {
      const { data: f } = await supabase
        .from('folders')
        .select('*')
        .in('id', folderIds)
        .eq('is_deleted', false)
        .eq('is_hidden', false);

      const activeFolders = f || [];

      if (activeFolders.length > 0) {
        const ownerIds = [...new Set(activeFolders.map(folder => folder.owner_id))];
        const [allFoldersRes, allFilesRes] = await Promise.all([
          supabase.from('folders').select('id, parent_id, is_deleted, is_hidden').in('owner_id', ownerIds),
          supabase.from('files').select('id, folder_id, size_bytes').in('owner_id', ownerIds).eq('is_deleted', false).eq('is_hidden', false)
        ]);

        const allFolders = allFoldersRes.data || [];
        const allFiles = allFilesRes.data || [];

        folders = activeFolders.map(folder => {
          const share = shares.find(s => s.resource_type === 'folder' && s.resource_id === folder.id);
          const metrics = getFolderMetrics(folder.id, allFolders, allFiles);
          return { 
            ...folder, 
            permission: share ? share.role : 'viewer',
            ownerName: share?.created_by?.name || 'Unknown',
            ownerEmail: share?.created_by?.email || 'Unknown',
            fileCount: metrics.fileCount,
            folderCount: metrics.folderCount,
            totalSize: metrics.totalSize
          };
        });
      }
    }
    
    if (fileIds.length > 0) {
      const { data: f } = await supabase
        .from('files')
        .select('*')
        .in('id', fileIds)
        .eq('is_deleted', false)
        .eq('is_hidden', false);

      files = (f || []).map(file => {
        const share = shares.find(s => s.resource_type === 'file' && s.resource_id === file.id);
        return { 
          ...file, 
          permission: share ? share.role : 'viewer',
          ownerName: share?.created_by?.name || 'Unknown',
          ownerEmail: share?.created_by?.email || 'Unknown'
        };
      });
    }

    res.status(200).json(keysToCamel({ folders, files }));
  } catch (error) {
    next(error);
  }
};

exports.getShares = async (req, res, next) => {
  try {
    const { resourceType, resourceId } = req.params;

    const { data, error } = await supabase
      .from('shares')
      .select('*, grantee:users!grantee_user_id(id, email, name)')
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
