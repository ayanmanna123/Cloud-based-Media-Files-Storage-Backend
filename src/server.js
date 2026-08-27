require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const { initCronJobs } = require('./utils/cronJobs');
const routes = require('./routes');

const app = express();
const PORT = process.env.PORT || 5000;

// Rate limiting middleware
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 200, // Limit each IP to 200 requests per `window` (here, per 15 minutes).
  standardHeaders: 'draft-7', // draft-6: `RateLimit-*` headers; draft-7: combined `RateLimit` header
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers.
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests, please try again later.' } }
});

// Initialize Cron Jobs
initCronJobs();

// Global Middlewares
app.use(helmet({
  crossOriginOpenerPolicy: false,
}));
app.use(limiter); // Apply rate limiting to all requests
const allowedOrigins = ['http://localhost:5173', 'https://cloud-based-media-files-storage-fro.vercel.app'];
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
})); // Enable credentials for cookies
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
