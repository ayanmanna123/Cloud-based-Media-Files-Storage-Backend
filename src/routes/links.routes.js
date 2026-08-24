const express = require('express');
const linksController = require('../controllers/links.controller');
const { protect } = require('../middlewares/auth.middleware');

const router = express.Router();

// GET link is public (with potential password)
router.get('/:token', linksController.getLink);
router.get('/bundle/:token', linksController.getBundleShare);

// Creating/Deleting links requires auth
router.use(protect);
router.get('/resource/:resourceType/:resourceId', linksController.getLinkForResource);
router.post('/', linksController.createLinkShare);
router.post('/bundle', linksController.createBundleShare);
router.delete('/:id', linksController.deleteLinkShare);

module.exports = router;
