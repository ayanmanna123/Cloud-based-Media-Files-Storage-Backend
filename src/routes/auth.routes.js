const express = require('express');
const authController = require('../controllers/auth.controller');
const { protect } = require('../middlewares/auth.middleware');

const router = express.Router();

router.post('/register', authController.register);
router.get(['/verify/:token', '/verify-email'], authController.verifyEmail);
router.post('/login', authController.login);
router.post('/google', authController.googleLogin);
router.post('/logout', authController.logout);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);

// Passkey Routes
router.get(['/passkeys/register-options', '/passkey/register-options'], protect, authController.generatePasskeyRegistrationOptions);
router.post(['/passkeys/register-verify', '/passkey/register-verify'], protect, authController.verifyPasskeyRegistration);
router.post(['/passkeys/login-options', '/passkey/login-options'], authController.generatePasskeyLoginOptions);
router.post(['/passkeys/login-verify', '/passkey/login-verify'], authController.verifyPasskeyLogin);

router.post('/secret-code', protect, authController.updateSecretCode);
router.get('/me', protect, authController.getMe);

module.exports = router;
