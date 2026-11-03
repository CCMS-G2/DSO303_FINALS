const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { authenticate, requireRole } = require('./middleware/auth');
const asyncHandler = require('./asyncHandler');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_TTL = '1h';

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
  if (!fullName || !email || !password) {
    return res.status(400).json({ error: 'fullName, email and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  // TODO: restrict to the college email domain with a regex check, as in the proposal.
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO auth.users (full_name, email, password_hash, role)
       VALUES ($1, $2, $3, 'STUDENT') RETURNING *`,
      [fullName, email.toLowerCase(), hash],
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
  const { rows } = await pool.query('SELECT * FROM auth.users WHERE email = $1', [email.toLowerCase()]);
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
  if (!fullName || !email || !password || !['STAFF', 'ADMIN'].includes(role)) {
    return res.status(400).json({ error: 'fullName, email, password and role (STAFF or ADMIN) are required' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO auth.users (full_name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING *`,
      [fullName, email.toLowerCase(), hash, role],
    );
    res.status(201).json(publicUser(rows[0]));
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already registered' });
    throw err;
  }
}));

app.patch('/api/users/:id', authenticate, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const { role, isActive } = req.body || {};
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
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`auth-service listening on ${port}`));
