class AppError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const notFound = (req, res) => res.status(404).json({ error: `Route ${req.method} ${req.originalUrl} not found` });

// Maps PostgreSQL error codes to HTTP status codes
const errorHandler = (err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
  if (err.code === '23505') return res.status(409).json({ error: 'Resource already exists' });
  if (err.code === '23503') return res.status(400).json({ error: 'Referenced resource does not exist' });
  if (err.code === '23514' || err.code === '22P02') return res.status(400).json({ error: 'Invalid data' });
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Internal server error' : err.message });
};
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
module.exports = { AppError, notFound, errorHandler, wrap };
