const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const amqp = require('amqplib');

const { PORT = 4001, DATABASE_URL, RABBITMQ_URL, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
const ROLES = ['user', 'manager', 'admin'];
const pool = new Pool({ connectionString: DATABASE_URL });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const retry = async (fn, name) => {
  for (let i = 0; i < 30; i++) { try { return await fn(); } catch (e) { console.log(`Waiting for ${name}...`); await sleep(2000); } }
  throw new Error(`${name} unavailable`);
};

// ---- RabbitMQ publisher ----
let channel;
const publish = (key, payload) => {
  if (!channel) return;
  channel.publish('events', key, Buffer.from(JSON.stringify({ ...payload, at: new Date().toISOString() })));
};

// ---- Middleware ----
const authenticate = (req, res, next) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid or expired token' }); }
};
const authorize = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Forbidden: insufficient role' });

const sign = (u) => jwt.sign({ id: u.id, email: u.email, role: u.role }, JWT_SECRET, { expiresIn: '1h' });
const validEmail = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ service: 'auth', status: 'ok' }));

app.post('/auth/register', async (req, res) => {
  const { email, password, name } = req.body || {};
  if (!validEmail(email)) return res.status(400).json({ error: 'Valid email required' });
  if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const hash = await bcrypt.hash(password, 10);
  try {
    const { rows } = await pool.query(
      'INSERT INTO users(email,name,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,email,name,role',
      [email.toLowerCase(), name || null, hash, 'user']);
    publish('user.registered', { id: rows[0].id, email: rows[0].email });
    res.status(201).json({ user: rows[0], token: sign(rows[0]) });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Email already registered' });
    console.error(e); res.status(500).json({ error: 'Server error' });
  }
});

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!validEmail(email) || typeof password !== 'string') return res.status(400).json({ error: 'Email and password required' });
  const { rows } = await pool.query('SELECT * FROM users WHERE email=$1', [email.toLowerCase()]);
  const u = rows[0];
  if (!u || !(await bcrypt.compare(password, u.password_hash))) return res.status(401).json({ error: 'Invalid credentials' });
  publish('user.login', { id: u.id, email: u.email });
  res.json({ token: sign(u), user: { id: u.id, email: u.email, role: u.role } });
});

app.get('/auth/me', authenticate, (req, res) => res.json({ user: req.user }));

app.get('/auth/users', authenticate, authorize('admin'), async (req, res) => {
  const { rows } = await pool.query('SELECT id,email,name,role,created_at FROM users ORDER BY id');
  res.json(rows);
});

app.patch('/auth/users/:id/role', authenticate, authorize('admin'), async (req, res) => {
  const { role } = req.body || {};
  if (!ROLES.includes(role)) return res.status(400).json({ error: `role must be one of ${ROLES.join(', ')}` });
  const { rows } = await pool.query('UPDATE users SET role=$1 WHERE id=$2 RETURNING id,email,role', [role, Number(req.params.id) || 0]);
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  publish('user.role_changed', rows[0]);
  res.json(rows[0]);
});

(async () => {
  await retry(() => pool.query(`CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL, name VARCHAR(100),
    password_hash TEXT NOT NULL, role VARCHAR(20) NOT NULL DEFAULT 'user',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`), 'postgres');
  const conn = await retry(() => amqp.connect(RABBITMQ_URL), 'rabbitmq');
  channel = await conn.createChannel();
  await channel.assertExchange('events', 'topic', { durable: true });
  if (ADMIN_EMAIL && ADMIN_PASSWORD) {
    await pool.query(
      `INSERT INTO users(email,name,password_hash,role) VALUES($1,'Admin',$2,'admin') ON CONFLICT (email) DO NOTHING`,
      [ADMIN_EMAIL, await bcrypt.hash(ADMIN_PASSWORD, 10)]);
  }
  app.listen(PORT, () => console.log(`auth-service on ${PORT}`));
})().catch((e) => { console.error(e); process.exit(1); });
