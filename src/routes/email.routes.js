const express = require('express');
const router = express.Router();
const { sendShareEmail, sendVerificationEmail, sendPasswordResetEmail } = require('../utils/email');

// Dedicated Vercel Email API endpoints
router.post('/share', async (req, res, next) => {
  try {
    const { email, sharerName, resourceName, role, message } = req.body;
    if (!email || !resourceName) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    await sendShareEmail(email, sharerName || 'Someone', resourceName, role || 'viewer', message);
    res.status(200).json({ status: 'success', message: 'Share email sent successfully' });
  } catch (error) {
    next(error);
  }
});

router.post('/verification', async (req, res, next) => {
  try {
    const { email, verificationToken } = req.body;
    if (!email || !verificationToken) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    await sendVerificationEmail(email, verificationToken);
    res.status(200).json({ status: 'success', message: 'Verification email sent successfully' });
  } catch (error) {
    next(error);
  }
});

router.post('/reset-password', async (req, res, next) => {
  try {
    const { email, resetToken } = req.body;
    if (!email || !resetToken) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    await sendPasswordResetEmail(email, resetToken);
    res.status(200).json({ status: 'success', message: 'Password reset email sent successfully' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
