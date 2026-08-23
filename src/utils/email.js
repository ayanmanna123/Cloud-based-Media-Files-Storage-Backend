const nodemailer = require('nodemailer');

// Reuse a single transporter for Ethereal email
let transporter;

const createTransporter = async () => {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || "smtp.ethereal.email",
    port: process.env.EMAIL_PORT || 587,
    secure: process.env.EMAIL_SECURE === 'true', 
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  return transporter;
};

const sendVerificationEmail = async (email, verificationToken) => {
  const mailTransporter = await createTransporter();
  
  // Frontend URL for verification
  // In production, this would be an environment variable
  const verifyUrl = `http://localhost:5173/verify?token=${verificationToken}`;

  const mailOptions = {
    from: '"CloudBox Admin" <admin@cloudbox.local>', // sender address
    to: email, // list of receivers
    subject: "Verify your Email - CloudBox", // Subject line
    text: `Welcome to CloudBox! Please verify your email by clicking on the following link: ${verifyUrl}`, // plain text body
    html: `
      <h2>Welcome to CloudBox!</h2>
      <p>Please verify your email address by clicking the link below:</p>
      <a href="${verifyUrl}" target="_blank">Verify Email</a>
      <p>If you did not request this, please ignore this email.</p>
    `, // html body
  };

  const info = await mailTransporter.sendMail(mailOptions);

  console.log("Verification email sent: %s", info.messageId);
};

const sendPasswordResetEmail = async (email, resetToken) => {
  const mailTransporter = await createTransporter();
  
  // Frontend URL for password reset
  const resetUrl = `http://localhost:5173/reset-password?token=${resetToken}`;

  const mailOptions = {
    from: '"CloudBox Admin" <admin@cloudbox.local>',
    to: email,
    subject: "Password Reset Request - CloudBox",
    text: `You requested a password reset. Click the link to reset your password: ${resetUrl}`,
    html: `
      <h2>Password Reset Request</h2>
      <p>You requested to reset your password. Click the link below to set a new password:</p>
      <a href="${resetUrl}" target="_blank">Reset Password</a>
      <p>If you did not request this, please ignore this email. This link will expire in 1 hour.</p>
    `,
  };

  const info = await mailTransporter.sendMail(mailOptions);
  console.log("Password reset email sent: %s", info.messageId);
};

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
