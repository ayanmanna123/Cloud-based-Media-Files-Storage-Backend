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

exports.getRoot = async (req, res, next) => {
  try {
    // Get top-level folders (parent_id is null)
    const { data: foldersData } = await supabase
      .from('folders')
      .select('*, files(id, size_bytes, is_deleted)')
      .is('parent_id', null)
      .eq('owner_id', req.user.id)
      .eq('is_deleted', false);

    const folders = foldersData?.map(f => {
      const activeFiles = f.files ? f.files.filter(file => !file.is_deleted) : [];
      return {
        ...f,
        fileCount: activeFiles.length,
        totalSize: activeFiles.reduce((acc, file) => acc + (file.size_bytes || 0), 0)
      };
    }) || [];

    // Get top-level files (folder_id is null)
    const { data: files } = await supabase
      .from('files')
      .select('*')
      .is('folder_id', null)
      .eq('owner_id', req.user.id)
      .eq('is_deleted', false);

    res.status(200).json({
      folder: { name: 'My Drive', id: null },
      children: {
        folders: keysToCamel(folders || []),
        files: keysToCamel(files || []),
      },
      path: []
    });
  } catch (error) {
    next(error);
  }
};

exports.getAllFolders = async (req, res, next) => {
  try {
    const { data: foldersData, error } = await supabase
      .from('folders')
      .select('id, name, parent_id, files(id, size_bytes, is_deleted)')
      .eq('owner_id', req.user.id)
      .eq('is_deleted', false)
      .order('name');
      
    const folders = foldersData?.map(f => {
      const activeFiles = f.files ? f.files.filter(file => !file.is_deleted) : [];
      return {
        ...f,
        fileCount: activeFiles.length,
        totalSize: activeFiles.reduce((acc, file) => acc + (file.size_bytes || 0), 0)
      };
    }) || [];

    if (error) {
      throw new AppError(error.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
    }

    res.status(200).json(keysToCamel(folders || []));
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
    const { data: subfoldersData } = await supabase
      .from('folders')
      .select('*, files(id, size_bytes, is_deleted)')
      .eq('parent_id', id)
      .eq('owner_id', req.user.id)
      .eq('is_deleted', false);

    const folders = subfoldersData?.map(f => {
      const activeFiles = f.files ? f.files.filter(file => !file.is_deleted) : [];
      return {
        ...f,
        fileCount: activeFiles.length,
        totalSize: activeFiles.reduce((acc, file) => acc + (file.size_bytes || 0), 0)
      };
    }) || [];

    // 3. Get children (files)
    const { data: files } = await supabase
      .from('files')
      .select('*')
      .eq('folder_id', id)
      .eq('owner_id', req.user.id)
      .eq('is_deleted', false);

    // 4. Build path recursively (or iteratively)
    let path = [];
    let currentParentId = folder.parent_id;
    
    // Safety limit to prevent infinite loops in corrupted data
    let depth = 0;
    while (currentParentId && depth < 20) {
      const { data: parentFolder } = await supabase
        .from('folders')
        .select('id, name, parent_id')
        .eq('id', currentParentId)
        .single();
        
      if (parentFolder) {
        path.unshift({ id: parentFolder.id, name: parentFolder.name });
        currentParentId = parentFolder.parent_id;
      } else {
        break;
      }
      depth++;
    }
    
    // Add the current folder as the last item in the path
    path.push({ id: folder.id, name: folder.name });

    res.status(200).json({
      folder: keysToCamel(folder),
      children: {
        folders: keysToCamel(folders || []),
        files: keysToCamel(files || []),
      },
      path: keysToCamel(path)
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

exports.copyFolder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { parentId } = req.body; // target parent folder id

    // 1. Fetch the source folder
    const { data: sourceFolder, error: folderError } = await supabase
      .from('folders')
      .select('*')
      .eq('id', id)
      .eq('owner_id', req.user.id)
      .eq('is_deleted', false)
      .single();

    if (folderError || !sourceFolder) {
      throw new AppError('Folder not found', ERROR_CODES.NOT_FOUND.status, ERROR_CODES.NOT_FOUND.code);
    }

    // 2. Check for name collisions at the target destination
    let query = supabase
      .from('folders')
      .select('name')
      .eq('owner_id', req.user.id)
      .eq('is_deleted', false);
      
    if (parentId) {
      query = query.eq('parent_id', parentId);
    } else {
      query = query.is('parent_id', null);
    }

    const { data: existingFolders } = await query;
    const existingNames = new Set((existingFolders || []).map(f => f.name));

    let newName = sourceFolder.name;
    let counter = 1;
    while (existingNames.has(newName)) {
      newName = `${sourceFolder.name} (Copy ${counter})`;
      counter++;
    }

    // Recursive helper
    const copyContents = async (srcFolderId, targetParentId) => {
      // Fetch subfolders
      const { data: subfolders } = await supabase
        .from('folders')
        .select('*')
        .eq('parent_id', srcFolderId)
        .eq('is_deleted', false);
        
      if (subfolders && subfolders.length > 0) {
        for (const sub of subfolders) {
          const { data: newSub } = await supabase
            .from('folders')
            .insert([{
              name: sub.name,
              parent_id: targetParentId,
              owner_id: req.user.id
            }])
            .select()
            .single();
            
          if (newSub) {
            await copyContents(sub.id, newSub.id);
          }
        }
      }

      // Fetch files
      const { data: files } = await supabase
        .from('files')
        .select('*')
        .eq('folder_id', srcFolderId)
        .eq('is_deleted', false);
        
      if (files && files.length > 0) {
        for (const file of files) {
          const { data: newFile } = await supabase
            .from('files')
            .insert([{
              name: file.name,
              mime_type: file.mime_type,
              size_bytes: file.size_bytes,
              storage_key: file.storage_key,
              owner_id: req.user.id,
              folder_id: targetParentId
            }])
            .select()
            .single();

          if (newFile) {
            const { data: version } = await supabase
              .from('file_versions')
              .insert([{
                file_id: newFile.id,
                version_number: 1,
                storage_key: file.storage_key,
                size_bytes: file.size_bytes,
              }])
              .select('id')
              .single();

            if (version) {
              await supabase
                .from('files')
                .update({ version_id: version.id })
                .eq('id', newFile.id);
            }
          }
        }
      }
    };

    // 3. Create the top-level copied folder
    const { data: newFolder, error: insertError } = await supabase
      .from('folders')
      .insert([{
        name: newName,
        parent_id: parentId || null,
        owner_id: req.user.id
      }])
      .select()
      .single();

    if (insertError) {
      throw new AppError(insertError.message, ERROR_CODES.INTERNAL_SERVER_ERROR.status, ERROR_CODES.INTERNAL_SERVER_ERROR.code);
    }

    // 4. Start recursion
    await copyContents(id, newFolder.id);

    res.status(200).json(keysToCamel(newFolder));
  } catch (error) {
    next(error);
  }
};
