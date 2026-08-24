const supabase = require('../config/supabase');
const { AppError, ERROR_CODES } = require('../utils/error');
const { keysToCamel } = require('../utils/caseConverter');

exports.trackOpen = async (req, res, next) => {
  try {
    const { id, type } = req.body; // type is 'file' or 'folder'
    
    if (!id || !['file', 'folder'].includes(type)) {
      return res.status(400).json({ status: 'error', message: 'Invalid id or type' });
    }

    const table = type === 'file' ? 'files' : 'folders';

    const { error } = await supabase
      .from(table)
      .update({ last_opened_at: new Date().toISOString() })
      .eq('id', id)
      .eq('owner_id', req.user.id);

    if (error) {
      // If column doesn't exist yet, we just ignore the error gracefully
      console.error(`Failed to track open for ${type} ${id}:`, error.message);
    }

    res.status(200).json({ status: 'success' });
  } catch (error) {
    next(error);
  }
};

exports.getRecentItems = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Helper to safely execute query
    const safeQuery = (query) => query.then(res => res).catch(() => ({ data: [] }));

    // Fetch top 50 files by open date and top 50 files by update date
    const [filesOpen, filesUpdate, foldersOpen, foldersUpdate] = await Promise.all([
      safeQuery(supabase.from('files').select('*').eq('owner_id', userId).eq('is_deleted', false).order('last_opened_at', { ascending: false, nullsFirst: false }).limit(50)),
      safeQuery(supabase.from('files').select('*').eq('owner_id', userId).eq('is_deleted', false).order('updated_at', { ascending: false }).limit(50)),
      safeQuery(supabase.from('folders').select('*, files(id, size_bytes)').eq('owner_id', userId).eq('is_deleted', false).order('last_opened_at', { ascending: false, nullsFirst: false }).limit(50)),
      safeQuery(supabase.from('folders').select('*, files(id, size_bytes)').eq('owner_id', userId).eq('is_deleted', false).order('updated_at', { ascending: false }).limit(50))
    ]);

    // Helper to extract data
    const getSafeData = (result) => (result && result.data) ? result.data : [];

    const allFiles = [...getSafeData(filesOpen), ...getSafeData(filesUpdate)];
    const allFolders = [...getSafeData(foldersOpen), ...getSafeData(foldersUpdate)];

    // Deduplicate
    const uniqueFilesMap = new Map();
    allFiles.forEach(f => uniqueFilesMap.set(f.id, f));
    
    const uniqueFoldersMap = new Map();
    allFolders.forEach(f => {
      // Calculate fileCount and totalSize for folders
      if (f.files) {
        f.fileCount = f.files.length;
        f.totalSize = f.files.reduce((sum, file) => sum + (file.size_bytes || 0), 0);
        delete f.files;
      }
      uniqueFoldersMap.set(f.id, f);
    });

    const uniqueFiles = Array.from(uniqueFilesMap.values()).map(f => ({ ...f, item_type: 'file' }));
    const uniqueFolders = Array.from(uniqueFoldersMap.values()).map(f => ({ ...f, item_type: 'folder' }));

    // Combine and sort
    const combined = [...uniqueFiles, ...uniqueFolders];
    combined.sort((a, b) => {
      const dateA = new Date(a.last_opened_at || a.updated_at || a.created_at).getTime();
      const dateB = new Date(b.last_opened_at || b.updated_at || b.created_at).getTime();
      return dateB - dateA; // Descending
    });

    // Return top 50
    const top50 = combined.slice(0, 50);

    res.status(200).json(keysToCamel(top50));
  } catch (error) {
    next(error);
  }
};
