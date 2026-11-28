const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { authenticate, requireRole } = require('./middleware/auth');
const asyncHandler = require('./asyncHandler');
const { log, requestLogger } = require('./logger');
const { parseDomains, validateRegistration, validateNewUser, validateUserUpdate } = require('./validation');

const app = express();
app.use(helmet()); // security headers (proposal, Section 16)
app.use(cors());
app.use(express.json());
app.use(requestLogger);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_TTL = '1h';
const BCRYPT_COST = 12; // proposal, Section 16
// FR-01: students register with a college email. Comma-separated domains.
const ALLOWED_EMAIL_DOMAINS = parseDomains(process.env.ALLOWED_EMAIL_DOMAINS || 'ccms.edu');

if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set. Refusing to start.');
  process.exit(1);
}

const publicUser = (row) => ({
  id: row.id, fullName: row.full_name, email: row.email, role: row.role, isActive: row.is_active,
});

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'auth-service' }));

// ---- Public ----

app.post('/api/auth/register', asyncHandler(async (req, res) => {
  const { fullName, email, password } = req.body || {};
  const problem = validateRegistration(req.body, ALLOWED_EMAIL_DOMAINS);
  if (problem) return res.status(400).json({ error: problem });
  try {
    const hash = await bcrypt.hash(password, BCRYPT_COST);
    const { rows } = await pool.query(
      `INSERT INTO auth.users (full_name, email, password_hash, role)
       VALUES ($1, $2, $3, 'STUDENT') RETURNING *`,
      [String(fullName).trim(), email.trim().toLowerCase(), hash],
    );
    res.status(201).json(publicUser(rows[0]));
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already registered' });
    throw err;
  }
}));

app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
  const { rows } = await pool.query('SELECT * FROM auth.users WHERE email = $1', [String(email).trim().toLowerCase()]);
  const user = rows[0];
  if (!user || !user.is_active) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ sub: user.id, role: user.role, email: user.email, fullName: user.full_name },
    JWT_SECRET, { expiresIn: TOKEN_TTL });
  res.json({ token, user: publicUser(user) });
}));

// ---- Authenticated ----

app.get('/api/auth/me', authenticate, asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM auth.users WHERE id = $1', [req.user.sub]);
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  res.json(publicUser(rows[0]));
}));

// ---- Admin only ----

app.get('/api/users', authenticate, requireRole('ADMIN'), asyncHandler(async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM auth.users ORDER BY created_at DESC');
  res.json(rows.map(publicUser));
}));

app.post('/api/users', authenticate, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const { fullName, email, password, role } = req.body || {};
  const problem = validateNewUser(req.body);
  if (problem) return res.status(400).json({ error: problem });
  try {
    const hash = await bcrypt.hash(password, BCRYPT_COST);
    const { rows } = await pool.query(
      `INSERT INTO auth.users (full_name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING *`,
      [String(fullName).trim(), email.trim().toLowerCase(), hash, role],
    );
    res.status(201).json(publicUser(rows[0]));
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already registered' });
    throw err;
  }
}));

app.patch('/api/users/:id', authenticate, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const { role, isActive } = req.body || {};
  const problem = validateUserUpdate(req.body, req.params.id, req.user.sub);
  if (problem) return res.status(400).json({ error: problem });
  const { rows } = await pool.query(
    `UPDATE auth.users SET role = COALESCE($1, role), is_active = COALESCE($2, is_active),
       updated_at = now() WHERE id = $3 RETURNING *`,
    [role || null, isActive === undefined ? null : isActive, req.params.id],
  );
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  res.json(publicUser(rows[0]));
}));

// ---- Internal (called by the Complaint and Notification services) ----
// Not behind authenticate(): in AWS this sits on a private network path
// (VPC-internal) rather than going through API Gateway. For an extra layer
// locally, you could check a shared INTERNAL_API_KEY header - left as a TODO.

app.get('/internal/users/:id', asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM auth.users WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  res.json(publicUser(rows[0]));
}));

// Final error handler: anything thrown by an asyncHandler-wrapped route
// lands here as a JSON response instead of crashing the process.
app.use((err, req, res, _next) => {
  if (err.code === '22P02') return res.status(400).json({ error: 'Invalid id' }); // malformed UUID
  log({ level: 'error', msg: 'unhandled error', requestId: req.id, error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => log({ level: 'info', msg: `auth-service listening on ${port}` }));
