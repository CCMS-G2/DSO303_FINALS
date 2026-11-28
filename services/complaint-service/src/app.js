const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const axios = require('axios');
const { authenticate, requireRole } = require('./middleware/auth');
const { publishEvent } = require('./eventBus');
const asyncHandler = require('./asyncHandler');
const { log, requestLogger } = require('./logger');
const rules = require('./rules');

const app = express();
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } })); // security headers (proposal 16)
app.use(cors());
app.use(express.json());
app.use(requestLogger);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:3000';

if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set. Refusing to start.');
  process.exit(1);
}

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'complaint-service' }));

// Runs fn(client) inside one database transaction: either every write
// commits or none does (no complaint without its status-history row).
async function inTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ======================================================================
// Evidence photos (FR-04: up to 3 images, JPEG or PNG, 5 MB each)
//
// AWS (EVIDENCE_BUCKET set): the browser asks for a pre-signed S3 PUT URL and
// uploads straight to S3. The URL is valid for 5 minutes and the declared
// content type and size are signed into it, so S3 rejects a different file.
// Local: a small disk-backed stand-in with the same two-step flow.
// ======================================================================
const EVIDENCE_BUCKET = process.env.EVIDENCE_BUCKET;
const PRESIGN_SECONDS = 300;

let s3; let PutObjectCommand; let GetObjectCommand; let getSignedUrl;
if (EVIDENCE_BUCKET) {
  const s3sdk = require('@aws-sdk/client-s3');
  ({ PutObjectCommand, GetObjectCommand } = s3sdk);
  ({ getSignedUrl } = require('@aws-sdk/s3-request-presigner'));
  // Credentials come from the ECS task role. WHEN_REQUIRED stops the SDK from
  // signing a checksum of an empty body into the URL, which breaks browser PUTs.
  s3 = new s3sdk.S3Client({ requestChecksumCalculation: 'WHEN_REQUIRED' });
}

app.post('/api/complaints/uploads', authenticate, requireRole('STUDENT'), asyncHandler(async (req, res) => {
  const { contentType, size } = req.body || {};
  const check = rules.checkUploadRequest(contentType, size);
  if (!check.ok) return res.status(400).json({ error: check.error });
  const key = `uploads/${req.user.sub}/${crypto.randomUUID()}.${check.ext}`;
  if (EVIDENCE_BUCKET) {
    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: EVIDENCE_BUCKET, Key: key, ContentType: contentType, ContentLength: check.bytes }),
      { expiresIn: PRESIGN_SECONDS },
    );
    return res.json({ key, uploadUrl });
  }
  const port = process.env.PORT || 3001;
  res.json({ key, uploadUrl: `http://localhost:${port}/api/complaints/uploads/raw/${encodeURIComponent(key)}` });
}));

// Adds short-lived download links for each complaint's photos (AWS only;
// locally the frontend builds the URL from the key).
async function withImageUrls(rows) {
  if (!EVIDENCE_BUCKET) return rows;
  return Promise.all(rows.map(async (c) => ({
    ...c,
    imageUrls: await Promise.all((c.image_keys || []).map((key) => getSignedUrl(
      s3, new GetObjectCommand({ Bucket: EVIDENCE_BUCKET, Key: key }), { expiresIn: PRESIGN_SECONDS },
    ))),
  })));
}

if (!EVIDENCE_BUCKET) {
  const EVIDENCE_ROOT = path.join(__dirname, '..', 'data', 'evidence');
  fs.mkdirSync(EVIDENCE_ROOT, { recursive: true });

  app.put('/api/complaints/uploads/raw/:key(*)',
    express.raw({ type: rules.ALLOWED_IMAGE_TYPES, limit: rules.MAX_IMAGE_BYTES }), (req, res) => {
      if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Expected a JPEG or PNG body' });
      const safeKey = req.params.key.replace(/\.\./g, '');
      const dest = path.join(EVIDENCE_ROOT, safeKey);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, req.body);
      res.status(200).end();
    });

  // GET /api/complaints/uploads/file/uploads/<userId>/<uuid>.jpg
  app.use('/api/complaints/uploads/file', express.static(EVIDENCE_ROOT));
}

// ======================================================================
// Complaint lifecycle
// ======================================================================

async function getComplaintOr404(id, res) {
  const { rows } = await pool.query('SELECT * FROM complaint.complaints WHERE id = $1', [id]);
  if (!rows[0]) { res.status(404).json({ error: 'Complaint not found' }); return null; }
  return rows[0];
}

app.post('/api/complaints', authenticate, requireRole('STUDENT'), asyncHandler(async (req, res) => {
  const { categoryId, locationId, title, description, imageKeys } = req.body || {};
  if (!categoryId || !locationId || !title || !description) {
    return res.status(400).json({ error: 'categoryId, locationId, title and description are required' });
  }
  const images = rules.checkImageKeys(imageKeys, req.user.sub);
  if (!images.ok) return res.status(400).json({ error: images.error });

  const complaint = await inTransaction(async (client) => {
    const { rows: seqRows } = await client.query("SELECT nextval('complaint.reference_seq') AS n");
    const { rows } = await client.query(
      `INSERT INTO complaint.complaints
         (reference_no, student_id, category_id, location_id, title, description, image_keys)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [rules.referenceNumber(new Date().getFullYear(), seqRows[0].n), req.user.sub,
        categoryId, locationId, title, description, images.keys],
    );
    await client.query(
      `INSERT INTO complaint.complaint_status_history (complaint_id, from_status, to_status, changed_by)
       VALUES ($1, NULL, 'SUBMITTED', $2)`,
      [rows[0].id, req.user.sub],
    );
    return rows[0];
  });

  // Published after commit; a failure here never fails the request, because
  // the complaint is already saved (proposal, Section 14).
  publishEvent('COMPLAINT_SUBMITTED', {
    complaintId: complaint.id, referenceNo: complaint.reference_no,
    recipients: [{ userId: req.user.sub, role: 'STUDENT' }],
  });
  res.status(201).json(complaint);
}));

// Lists complaints. Students see their own, staff their assigned ones, admins
// all. Filters: status, category, location, from, to (YYYY-MM-DD), staff (admin).
app.get('/api/complaints', authenticate, asyncHandler(async (req, res) => {
  const filter = rules.buildListFilter(req.user, req.query, 'x');
  if (filter.error) return res.status(400).json({ error: filter.error });
  const { rows } = await pool.query(
    `SELECT x.*, c.name AS category_name, l.name AS location_name
       FROM complaint.complaints x
       JOIN complaint.categories c ON c.id = x.category_id
       JOIN complaint.locations l ON l.id = x.location_id
     ${filter.where}
     ORDER BY x.created_at DESC`,
    filter.params,
  );
  res.json(await withImageUrls(rows));
}));

app.get('/api/complaints/:id', authenticate, asyncHandler(async (req, res) => {
  const complaint = await getComplaintOr404(req.params.id, res);
  if (!complaint) return;
  if (!rules.canView(req.user, complaint)) return res.status(403).json({ error: 'Forbidden' });
  const { rows: history } = await pool.query(
    'SELECT * FROM complaint.complaint_status_history WHERE complaint_id = $1 ORDER BY changed_at', [complaint.id],
  );
  const { rows: notes } = await pool.query(
    'SELECT * FROM complaint.complaint_notes WHERE complaint_id = $1 ORDER BY created_at', [complaint.id],
  );
  const [withUrls] = await withImageUrls([complaint]);
  res.json({ ...withUrls, history, notes });
}));

app.patch('/api/complaints/:id/assign', authenticate, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const { staffId } = req.body || {};
  if (!staffId) return res.status(400).json({ error: 'staffId is required' });
  const complaint = await getComplaintOr404(req.params.id, res);
  if (!complaint) return;
  if (!rules.canAssign(complaint.status)) {
    return res.status(409).json({ error: `Cannot assign a complaint in status ${complaint.status}` });
  }

  // Service-to-service call: confirm the chosen user is active staff
  // (Complaint -> internal ALB -> Auth in the architecture diagram).
  try {
    const { data: staff } = await axios.get(`${AUTH_SERVICE_URL}/internal/users/${staffId}`, {
      timeout: 5000, headers: { 'x-request-id': req.id },
    });
    if (staff.role !== 'STAFF' || !staff.isActive) {
      return res.status(400).json({ error: 'Target user is not an active staff member' });
    }
  } catch (err) {
    if (err.response && err.response.status === 404) return res.status(400).json({ error: 'Staff user not found' });
    log({ level: 'error', msg: 'auth-service lookup failed', requestId: req.id, error: err.message });
    return res.status(502).json({ error: 'Could not verify staff member (auth-service unavailable)' });
  }

  const updated = await inTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE complaint.complaints SET assigned_staff_id = $1, status = 'ASSIGNED', assigned_at = now(), updated_at = now()
       WHERE id = $2 RETURNING *`,
      [staffId, complaint.id],
    );
    await client.query(
      `INSERT INTO complaint.complaint_status_history (complaint_id, from_status, to_status, changed_by)
       VALUES ($1, $2, 'ASSIGNED', $3)`,
      [complaint.id, complaint.status, req.user.sub],
    );
    return rows[0];
  });
  publishEvent('COMPLAINT_ASSIGNED', {
    complaintId: complaint.id, referenceNo: complaint.reference_no,
    recipients: [{ userId: staffId, role: 'STAFF' }, { userId: complaint.student_id, role: 'STUDENT' }],
  });
  res.json(updated);
}));

app.patch('/api/complaints/:id/status', authenticate, asyncHandler(async (req, res) => {
  const { status: toStatus, note } = req.body || {};
  const complaint = await getComplaintOr404(req.params.id, res);
  if (!complaint) return;
  const check = rules.checkStatusChange(req.user, complaint, toStatus, note);
  if (!check.ok) return res.status(check.code).json({ error: check.error });

  const tsColumn = { RESOLVED: 'resolved_at', CLOSED: 'closed_at' }[toStatus];
  const updated = await inTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE complaint.complaints SET status = $1, updated_at = now()
         ${tsColumn ? `, ${tsColumn} = now()` : ''} WHERE id = $2 RETURNING *`,
      [toStatus, complaint.id],
    );
    await client.query(
      `INSERT INTO complaint.complaint_status_history (complaint_id, from_status, to_status, changed_by, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [complaint.id, complaint.status, toStatus, req.user.sub, note || null],
    );
    if (note) {
      await client.query(
        `INSERT INTO complaint.complaint_notes (complaint_id, author_id, note, is_resolution)
         VALUES ($1, $2, $3, $4)`,
        [complaint.id, req.user.sub, note, toStatus === 'RESOLVED'],
      );
    }
    return rows[0];
  });
  publishEvent('COMPLAINT_STATUS_CHANGED', {
    complaintId: complaint.id, referenceNo: complaint.reference_no, oldStatus: complaint.status, newStatus: toStatus,
    recipients: [{ userId: complaint.student_id, role: 'STUDENT' }],
  });
  res.json(updated);
}));

app.post('/api/complaints/:id/notes', authenticate, asyncHandler(async (req, res) => {
  const { note } = req.body || {};
  if (!note || !String(note).trim()) return res.status(400).json({ error: 'note is required' });
  const complaint = await getComplaintOr404(req.params.id, res);
  if (!complaint) return;
  if (!rules.canAddNote(req.user, complaint)) return res.status(403).json({ error: 'Forbidden' });
  const { rows } = await pool.query(
    'INSERT INTO complaint.complaint_notes (complaint_id, author_id, note) VALUES ($1, $2, $3) RETURNING *',
    [complaint.id, req.user.sub, String(note).trim()],
  );
  res.status(201).json(rows[0]);
}));

// ---- Reference data: categories and locations (FR-20: admins manage them) ----
// Everyone gets the active list; an admin adds ?all=1 to include inactive ones.

function referenceRoutes(table, columns) {
  const base = `/api/${table}`;
  app.get(base, authenticate, asyncHandler(async (req, res) => {
    const all = req.user.role === 'ADMIN' && req.query.all === '1';
    const { rows } = await pool.query(
      `SELECT * FROM complaint.${table} ${all ? '' : 'WHERE is_active'} ORDER BY name`,
    );
    res.json(rows);
  }));

  app.post(base, authenticate, requireRole('ADMIN'), asyncHandler(async (req, res) => {
    const values = columns.map((c) => (req.body || {})[c.field]);
    if (!values[0] || !String(values[0]).trim()) return res.status(400).json({ error: 'name is required' });
    try {
      const { rows } = await pool.query(
        `INSERT INTO complaint.${table} (${columns.map((c) => c.column).join(', ')})
         VALUES (${columns.map((_c, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
        values.map((v) => (v === undefined || v === '' ? null : String(v).trim())),
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'That name already exists' });
      throw err;
    }
  }));

  app.patch(`${base}/:id`, authenticate, requireRole('ADMIN'), asyncHandler(async (req, res) => {
    const { name, isActive } = req.body || {};
    const { rows } = await pool.query(
      `UPDATE complaint.${table} SET name = COALESCE($1, name), is_active = COALESCE($2, is_active)
       WHERE id = $3 RETURNING *`,
      [name ? String(name).trim() : null, typeof isActive === 'boolean' ? isActive : null, Number(req.params.id)],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  }));
}

referenceRoutes('categories', [{ field: 'name', column: 'name' }]);
referenceRoutes('locations', [
  { field: 'name', column: 'name' }, { field: 'building', column: 'building' },
  { field: 'locationType', column: 'location_type' },
]);

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

// FR-18: unresolved complaints older than ?days (default 3).
app.get('/api/stats/overdue', authenticate, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const days = Number(req.query.days || 3);
  if (!Number.isInteger(days) || days < 0) return res.status(400).json({ error: 'days must be a whole number' });
  const { rows } = await pool.query(
    `SELECT * FROM complaint.complaints
     WHERE status IN ('SUBMITTED', 'ASSIGNED', 'IN_PROGRESS') AND created_at < now() - make_interval(days => $1)
     ORDER BY created_at`,
    [days],
  );
  res.json(rows);
}));

// Final error handler: anything thrown by an asyncHandler-wrapped route
// lands here as a JSON response instead of crashing the process.
app.use((err, req, res, _next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Each image must be 5 MB or smaller' });
  if (err.code === '22P02') return res.status(400).json({ error: 'Invalid id' }); // malformed UUID / number
  if (err.code === '23503') return res.status(400).json({ error: 'Unknown category or location' });
  log({ level: 'error', msg: 'unhandled error', requestId: req.id, error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

const port = process.env.PORT || 3001;
app.listen(port, () => log({ level: 'info', msg: `complaint-service listening on ${port}` }));
