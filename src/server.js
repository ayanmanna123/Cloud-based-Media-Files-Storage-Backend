require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const { initCronJobs } = require('./utils/cronJobs');
const routes = require('./routes');

const app = express();
const PORT = process.env.PORT || 5000;

// Initialize Cron Jobs
initCronJobs();

// Global Middlewares
app.use(helmet({
  crossOriginOpenerPolicy: false,
}));
app.use(cors({ origin: true, credentials: true })); // Enable credentials for cookies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Health Check Endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Server is running' });
});

// API Routes
app.use('/api', routes);

// Global Error Handler
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const code = err.code || 'INTERNAL_SERVER_ERROR';
  const message = err.message || 'Something went wrong';

  // Only log stack traces for actual server errors (500s), not client errors (401s, 400s)
  if (statusCode >= 500) {
    console.error(err.stack);
  } else if (process.env.NODE_ENV !== 'production') {
    // Optionally log a short message for 4xx errors in development
    console.log(`[${statusCode}] ${message}`);
  }

  res.status(statusCode).json({
    error: {
      code,
      message,
    },
  });
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
