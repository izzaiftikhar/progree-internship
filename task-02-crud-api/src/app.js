const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { notFound, errorHandler } = require('./middleware/errors');

const app = express();

// Security headers
app.use(helmet());

// CORS: allow only explicitly configured browser origins.
// Requests without an Origin header (Postman, curl, server-to-server)
// are allowed because they do not use browser CORS enforcement.
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(null, false);
  },
}));

app.use(morgan('dev'));
app.use(express.json({ limit: '10kb' }));

// Global rate limiting
app.use(rateLimit({
  windowMs: 60_000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
}));

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/categories', require('./routes/categories'));
app.use('/api/products', require('./routes/products'));

app.use(notFound);
app.use(errorHandler);

module.exports = app;
