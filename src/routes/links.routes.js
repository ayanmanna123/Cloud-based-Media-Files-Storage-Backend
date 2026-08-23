const express = require('express');
const linksController = require('../controllers/links.controller');
const { protect } = require('../middlewares/auth.middleware');

const router = express.Router();

// GET link is public (with potential password)
router.get('/:token', linksController.getLink);

// Creating/Deleting links requires auth
router.use(protect);
router.post('/', linksController.createLinkShare);
router.delete('/:id', linksController.deleteLinkShare);

module.exports = router;
