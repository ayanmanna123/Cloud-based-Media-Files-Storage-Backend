const express = require('express');
const multer = require('multer');
const filesController = require('../controllers/files.controller');
const { protect } = require('../middlewares/auth.middleware');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB Telegram Bot API limit
});

// All file routes require authentication
router.use(protect);

router.post('/init', filesController.initFileUpload);
router.post('/complete', filesController.completeFileUpload);
router.post('/upload-telegram', upload.single('file'), filesController.uploadTelegramFile);
router.get('/recent', filesController.getRecentFiles);
router.get('/:id', filesController.getFile);
router.get('/:id/view', filesController.viewFile);

router.patch('/:id', filesController.updateFile);
router.delete('/:id', filesController.deleteFile);
router.post('/:id/copy', filesController.copyFile);

// Version history routes
router.get('/:id/versions', filesController.getFileVersions);
router.post('/:id/versions/restore', filesController.restoreFileVersion);

module.exports = router;

