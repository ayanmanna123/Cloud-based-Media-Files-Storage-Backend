const express = require('express');
const router = express.Router();

// Define API routes here as the project grows
// const mediaRoutes = require('./media.routes');
// router.use('/media', mediaRoutes);

router.get('/', (req, res) => {
  res.json({ message: 'Welcome to the Media Storage API' });
});

module.exports = router;
