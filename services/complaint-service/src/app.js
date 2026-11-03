const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const axios = require('axios');
const { authenticate, requireRole } = require('./middleware/auth');
const { publishEvent } = require('./eventBus');
const asyncHandler = require('./asyncHandler');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:3000';

if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set. Refusing to start.');
  process.exit(1);
}

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'complaint-service' }));

// ======================================================================
// Mock evidence storage. In AWS this becomes: POST here returns a real S3
// pre-signed PUT URL, the browser uploads straight to S3, and this service
// never sees the file bytes. Locally we stand in with a small disk-backed
// file server so the frontend's two-step flow (ask for URL, then upload)
// doesn't need to change later. See README.md "Local -> AWS" table.
// ======================================================================

// Files are stored on disk at EVIDENCE_ROOT/<key>, where <key> already looks
// like "uploads/<userId>/<uuid>.jpg" (matching the proposal's S3 key format).
// GET requests are served from the same root, so a client always fetches a
// file at /api/complaints/uploads/file/<key> - no path translation needed.
const EVIDENCE_ROOT = path.join(__dirname, '..', 'data', 'evidence');
fs.mkdirSync(EVIDENCE_ROOT, { recursive: true });

app.post('/api/complaints/uploads', authenticate, requireRole('STUDENT'), (req, res) => {
  const { contentType } = req.body || {};
  if (!contentType || !contentType.startsWith('image/')) {
    return res.status(400).json({ error: 'contentType must be an image/* type' });
  }
  const ext = contentType.split('/')[1] || 'bin';
  const key = `uploads/${req.user.sub}/${crypto.randomUUID()}.${ext}`;
  const port = process.env.PORT || 3001;
  res.json({ key, uploadUrl: `http://localhost:${port}/api/complaints/uploads/raw/${encodeURIComponent(key)}` });
});

app.put('/api/complaints/uploads/raw/:key(*)', express.raw({ type: '*/*', limit: '6mb' }), (req, res) => {
  const safeKey = req.params.key.replace(/\.\./g, '');
  const dest = path.join(EVIDENCE_ROOT, safeKey);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, req.body);
  res.status(200).end();
});

// Fetching a file: GET /api/complaints/uploads/file/<key>, e.g.
// /api/complaints/uploads/file/uploads/<userId>/<uuid>.jpg
app.use('/api/complaints/uploads/file', express.static(EVIDENCE_ROOT));

// ======================================================================
// Complaint lifecycle
// ======================================================================

// Allowed transitions: who may make them, keyed "FROM->TO".
// Mirrors the table in the proposal (Section 9).
const TRANSITIONS = {
  'SUBMITTED->ASSIGNED': 'ADMIN_ONLY',
  'ASSIGNED->ASSIGNED': 'ADMIN_ONLY', // reassignment
  'IN_PROGRESS->ASSIGNED': 'ADMIN_ONLY',
  'ASSIGNED->IN_PROGRESS': 'ASSIGNED_STAFF',
  'IN_PROGRESS->RESOLVED': 'ASSIGNED_STAFF',
  'RESOLVED->CLOSED': 'OWNER_OR_ADMIN',
};

async function getComplaintOr404(id, res) {
  const { rows } = await pool.query('SELECT * FROM complaint.complaints WHERE id = $1', [id]);
  if (!rows[0]) { res.status(404).json({ error: 'Complaint not found' }); return null; }
  return rows[0];
}

function canView(user, complaint) {
  if (user.role === 'ADMIN') return true;
  if (user.role === 'STUDENT') return complaint.student_id === user.sub;
  if (user.role === 'STAFF') return complaint.assigned_staff_id === user.sub;
  return false;
}

app.post('/api/complaints', authenticate, requireRole('STUDENT'), asyncHandler(async (req, res) => {
  const { categoryId, locationId, title, description, imageKey } = req.body || {};
  if (!categoryId || !locationId || !title || !description) {
    return res.status(400).json({ error: 'categoryId, locationId, title and description are required' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: seqRows } = await client.query("SELECT nextval('complaint.reference_seq') AS n");
    const referenceNo = `CMP-${new Date().getFullYear()}-${String(seqRows[0].n).padStart(6, '0')}`;
    const { rows } = await client.query(
      `INSERT INTO complaint.complaints
         (reference_no, student_id, category_id, location_id, title, description, image_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [referenceNo, req.user.sub, categoryId, locationId, title, description, imageKey || null],
    );
    const complaint = rows[0];
    await client.query(
      `INSERT INTO complaint.complaint_status_history (complaint_id, from_status, to_status, changed_by)
       VALUES ($1, NULL, 'SUBMITTED', $2)`,
      [complaint.id, req.user.sub],
    );
    await client.query('COMMIT');

    // Event is published after commit, and failure here must never fail the
    // request - the complaint is already safely saved (see proposal 14).
    publishEvent('COMPLAINT_SUBMITTED', {
      complaintId: complaint.id, referenceNo: complaint.reference_no,
      recipients: [{ userId: req.user.sub, role: 'STUDENT' }],
    });
    res.status(201).json(complaint);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

app.get('/api/complaints', authenticate, asyncHandler(async (req, res) => {
  const { status, category } = req.query;
  const clauses = []; const params = [];
  if (req.user.role === 'STUDENT') { params.push(req.user.sub); clauses.push(`student_id = $${params.length}`); }
  if (req.user.role === 'STAFF') { params.push(req.user.sub); clauses.push(`assigned_staff_id = $${params.length}`); }
  if (status) { params.push(status); clauses.push(`status = $${params.length}`); }
  if (category) { params.push(category); clauses.push(`category_id = $${params.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT * FROM complaint.complaints ${where} ORDER BY created_at DESC`, params,
  );
  res.json(rows);
}));

app.get('/api/complaints/:id', authenticate, asyncHandler(async (req, res) => {
  const complaint = await getComplaintOr404(req.params.id, res);
  if (!complaint) return;
  if (!canView(req.user, complaint)) return res.status(403).json({ error: 'Forbidden' });
  const { rows: history } = await pool.query(
    'SELECT * FROM complaint.complaint_status_history WHERE complaint_id = $1 ORDER BY changed_at', [complaint.id],
  );
  const { rows: notes } = await pool.query(
    'SELECT * FROM complaint.complaint_notes WHERE complaint_id = $1 ORDER BY created_at', [complaint.id],
  );
  res.json({ ...complaint, history, notes });
}));

app.patch('/api/complaints/:id/assign', authenticate, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const { staffId } = req.body || {};
  if (!staffId) return res.status(400).json({ error: 'staffId is required' });
  const complaint = await getComplaintOr404(req.params.id, res);
  if (!complaint) return;
  const key = `${complaint.status}->ASSIGNED`;
  if (TRANSITIONS[key] !== 'ADMIN_ONLY') {
    return res.status(409).json({ error: `Cannot assign a complaint in status ${complaint.status}` });
  }

  // Service-to-service call: verify the chosen user really is active staff,
  // exactly as shown in the architecture diagram (Complaint -> Auth).
  try {
    const { data: staff } = await axios.get(`${AUTH_SERVICE_URL}/internal/users/${staffId}`);
    if (staff.role !== 'STAFF' || !staff.isActive) {
      return res.status(400).json({ error: 'Target user is not an active staff member' });
    }
  } catch (err) {
    if (err.response && err.response.status === 404) return res.status(400).json({ error: 'Staff user not found' });
    console.error('auth-service lookup failed:', err.message);
    return res.status(502).json({ error: 'Could not verify staff member (auth-service unavailable)' });
  }

  const { rows } = await pool.query(
    `UPDATE complaint.complaints SET assigned_staff_id = $1, status = 'ASSIGNED', assigned_at = now(), updated_at = now()
     WHERE id = $2 RETURNING *`,
    [staffId, complaint.id],
  );
  await pool.query(
    `INSERT INTO complaint.complaint_status_history (complaint_id, from_status, to_status, changed_by)
     VALUES ($1, $2, 'ASSIGNED', $3)`,
    [complaint.id, complaint.status, req.user.sub],
  );
  publishEvent('COMPLAINT_ASSIGNED', {
    complaintId: complaint.id, referenceNo: complaint.reference_no,
    recipients: [{ userId: staffId, role: 'STAFF' }, { userId: complaint.student_id, role: 'STUDENT' }],
  });
  res.json(rows[0]);
}));

app.patch('/api/complaints/:id/status', authenticate, asyncHandler(async (req, res) => {
  const { status: toStatus, note } = req.body || {};
  const complaint = await getComplaintOr404(req.params.id, res);
  if (!complaint) return;
  const key = `${complaint.status}->${toStatus}`;
  const rule = TRANSITIONS[key];
  if (!rule) return res.status(409).json({ error: `Cannot change status from ${complaint.status} to ${toStatus}` });

  const isAssignedStaff = req.user.role === 'STAFF' && complaint.assigned_staff_id === req.user.sub;
  const isOwner = req.user.role === 'STUDENT' && complaint.student_id === req.user.sub;
  const allowed =
    (rule === 'ASSIGNED_STAFF' && isAssignedStaff) ||
    (rule === 'OWNER_OR_ADMIN' && (isOwner || req.user.role === 'ADMIN'));
  if (!allowed) return res.status(403).json({ error: 'You are not allowed to make this change' });

  if (toStatus === 'RESOLVED' && !note) {
    return res.status(400).json({ error: 'A resolution note is required to resolve a complaint' });
  }

  const tsColumn = { RESOLVED: 'resolved_at', CLOSED: 'closed_at' }[toStatus];
  const { rows } = await pool.query(
    `UPDATE complaint.complaints SET status = $1, updated_at = now()
       ${tsColumn ? `, ${tsColumn} = now()` : ''} WHERE id = $2 RETURNING *`,
    [toStatus, complaint.id],
  );
  await pool.query(
    `INSERT INTO complaint.complaint_status_history (complaint_id, from_status, to_status, changed_by, note)
     VALUES ($1, $2, $3, $4, $5)`,
    [complaint.id, complaint.status, toStatus, req.user.sub, note || null],
  );
  if (note) {
    await pool.query(
      `INSERT INTO complaint.complaint_notes (complaint_id, author_id, note, is_resolution)
       VALUES ($1, $2, $3, $4)`,
      [complaint.id, req.user.sub, note, toStatus === 'RESOLVED'],
    );
  }
  publishEvent('COMPLAINT_STATUS_CHANGED', {
    complaintId: complaint.id, referenceNo: complaint.reference_no, oldStatus: complaint.status, newStatus: toStatus,
    recipients: [{ userId: complaint.student_id, role: 'STUDENT' }],
  });
  res.json(rows[0]);
}));

app.post('/api/complaints/:id/notes', authenticate, asyncHandler(async (req, res) => {
  const { note } = req.body || {};
  if (!note) return res.status(400).json({ error: 'note is required' });
  const complaint = await getComplaintOr404(req.params.id, res);
  if (!complaint) return;
  const allowed = req.user.role === 'ADMIN' || (req.user.role === 'STAFF' && complaint.assigned_staff_id === req.user.sub);
  if (!allowed) return res.status(403).json({ error: 'Forbidden' });
  const { rows } = await pool.query(
    `INSERT INTO complaint.complaint_notes (complaint_id, author_id, note) VALUES ($1, $2, $3) RETURNING *`,
    [complaint.id, req.user.sub, note],
  );
  res.status(201).json(rows[0]);
}));

// ---- Reference data ----

app.get('/api/categories', authenticate, asyncHandler(async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM complaint.categories WHERE is_active ORDER BY name');
  res.json(rows);
}));

app.get('/api/locations', authenticate, asyncHandler(async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM complaint.locations WHERE is_active ORDER BY name');
  res.json(rows);
}));

// ---- Statistics (admin) ----

app.get('/api/stats/summary', authenticate, requireRole('ADMIN'), asyncHandler(async (_req, res) => {
  const byStatus = await pool.query('SELECT status, count(*) FROM complaint.complaints GROUP BY status');
  const byCategory = await pool.query(
    `SELECT c.name, count(*) FROM complaint.complaints x JOIN complaint.categories c ON c.id = x.category_id
     GROUP BY c.name ORDER BY count(*) DESC`,
  );
  const avgResolution = await pool.query(
    `SELECT avg(extract(epoch FROM (resolved_at - created_at)) / 3600)::numeric(10,1) AS avg_hours
     FROM complaint.complaints WHERE resolved_at IS NOT NULL`,
  );
  res.json({
    byStatus: byStatus.rows, byCategory: byCategory.rows,
    avgResolutionHours: avgResolution.rows[0].avg_hours,
  });
}));

app.get('/api/stats/overdue', authenticate, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const days = Number(req.query.days || 3);
  const { rows } = await pool.query(
    `SELECT * FROM complaint.complaints
     WHERE status IN ('SUBMITTED', 'ASSIGNED', 'IN_PROGRESS') AND created_at < now() - ($1 || ' days')::interval
     ORDER BY created_at`,
    [days],
  );
  res.json(rows);
}));

// Final error handler: anything thrown by an asyncHandler-wrapped route
// lands here as a JSON response instead of crashing the process.
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`complaint-service listening on ${port}`));
