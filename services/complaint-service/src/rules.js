// Business rules of the Complaint Service, kept free of Express and the
// database so they can be unit tested (proposal NFR-07).

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

const STATUSES = ['SUBMITTED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png'];
const MAX_IMAGES = 3; // FR-04
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // FR-04: 5 MB per image

function canView(user, complaint) {
  if (user.role === 'ADMIN') return true;
  if (user.role === 'STUDENT') return complaint.student_id === user.sub;
  if (user.role === 'STAFF') return complaint.assigned_staff_id === user.sub;
  return false;
}

function canAssign(status) {
  return TRANSITIONS[`${status}->ASSIGNED`] === 'ADMIN_ONLY';
}

// Decides whether `user` may move `complaint` to `toStatus`.
// Returns { ok: true } or { ok: false, code, error } with the HTTP status to send.
function checkStatusChange(user, complaint, toStatus, note) {
  const rule = TRANSITIONS[`${complaint.status}->${toStatus}`];
  if (!rule || rule === 'ADMIN_ONLY') {
    // Assignment has its own endpoint, so ADMIN_ONLY moves are not valid here.
    return { ok: false, code: 409, error: `Cannot change status from ${complaint.status} to ${toStatus}` };
  }
  const isAssignedStaff = user.role === 'STAFF' && complaint.assigned_staff_id === user.sub;
  const isOwner = user.role === 'STUDENT' && complaint.student_id === user.sub;
  const allowed = (rule === 'ASSIGNED_STAFF' && isAssignedStaff)
    || (rule === 'OWNER_OR_ADMIN' && (isOwner || user.role === 'ADMIN'));
  if (!allowed) return { ok: false, code: 403, error: 'You are not allowed to make this change' };
  if (toStatus === 'RESOLVED' && !(note && String(note).trim())) {
    return { ok: false, code: 400, error: 'A resolution note is required to resolve a complaint' };
  }
  return { ok: true };
}

function canAddNote(user, complaint) {
  return user.role === 'ADMIN' || (user.role === 'STAFF' && complaint.assigned_staff_id === user.sub);
}

function referenceNumber(year, n) {
  return `CMP-${year}-${String(n).padStart(6, '0')}`;
}

// Validates an upload request: JPEG/PNG only, at most 5 MB.
function checkUploadRequest(contentType, size) {
  if (!ALLOWED_IMAGE_TYPES.includes(contentType)) {
    return { ok: false, error: 'contentType must be image/jpeg or image/png' };
  }
  const bytes = Number(size);
  if (!Number.isInteger(bytes) || bytes <= 0) return { ok: false, error: 'size (in bytes) is required' };
  if (bytes > MAX_IMAGE_BYTES) return { ok: false, error: 'Each image must be 5 MB or smaller' };
  return { ok: true, bytes, ext: contentType === 'image/png' ? 'png' : 'jpg' };
}

// Image keys sent with a new complaint: at most 3, and only keys this student
// was given (uploads/<their id>/...), so nobody can attach another user's file.
function checkImageKeys(keys, userId) {
  if (keys === undefined || keys === null) return { ok: true, keys: [] };
  if (!Array.isArray(keys)) return { ok: false, error: 'imageKeys must be an array' };
  if (keys.length > MAX_IMAGES) return { ok: false, error: `At most ${MAX_IMAGES} images per complaint` };
  const prefix = `uploads/${userId}/`;
  const bad = keys.find((k) => typeof k !== 'string' || !k.startsWith(prefix) || k.includes('..'));
  if (bad !== undefined) return { ok: false, error: 'Invalid image key' };
  return { ok: true, keys };
}

// Builds the WHERE clause for GET /api/complaints. Role scoping always comes
// first, so a filter can never widen what a user is allowed to see (FR-05, FR-14).
// `alias` is the SQL alias of the complaints table, e.g. 'x' -> x.status.
function buildListFilter(user, query = {}, alias = '') {
  const clauses = []; const params = [];
  const p = alias ? `${alias}.` : '';
  const add = (sql, value) => { params.push(value); clauses.push(p + sql.replace('?', `$${params.length}`)); };

  if (user.role === 'STUDENT') add('student_id = ?', user.sub);
  if (user.role === 'STAFF') add('assigned_staff_id = ?', user.sub);

  if (query.status) {
    if (!STATUSES.includes(query.status)) return { error: 'Unknown status' };
    add('status = ?', query.status);
  }
  if (query.category) add('category_id = ?', Number(query.category));
  if (query.location) add('location_id = ?', Number(query.location));
  if (user.role === 'ADMIN' && query.staff) add('assigned_staff_id = ?', query.staff);
  if (query.from) {
    if (Number.isNaN(Date.parse(query.from))) return { error: 'from must be a date (YYYY-MM-DD)' };
    add('created_at >= ?::date', query.from);
  }
  if (query.to) {
    if (Number.isNaN(Date.parse(query.to))) return { error: 'to must be a date (YYYY-MM-DD)' };
    add("created_at < ?::date + interval '1 day'", query.to);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

module.exports = {
  TRANSITIONS, STATUSES, ALLOWED_IMAGE_TYPES, MAX_IMAGES, MAX_IMAGE_BYTES,
  canView, canAssign, checkStatusChange, canAddNote, referenceNumber,
  checkUploadRequest, checkImageKeys, buildListFilter,
};
