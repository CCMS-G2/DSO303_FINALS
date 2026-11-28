// Input rules for the Auth Service, kept separate so they can be unit tested.

const ROLES = ['STUDENT', 'STAFF', 'ADMIN'];
const EMAIL_RE = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/;

// Comma-separated list, e.g. "ccms.edu,college.edu". Configured per environment
// through ALLOWED_EMAIL_DOMAINS (proposal FR-01: college email only).
function parseDomains(value) {
  return String(value || '')
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
}

// True when email belongs to one of the domains (exact match or a subdomain,
// so "student.ccms.edu" passes for "ccms.edu" but "ccms.edu.evil.com" does not).
function isCollegeEmail(email, domains) {
  const m = EMAIL_RE.exec(String(email || '').trim().toLowerCase());
  if (!m) return false;
  const host = m[1];
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

function validateRegistration({ fullName, email, password } = {}, domains) {
  if (!fullName || !String(fullName).trim() || !email || !password) {
    return 'fullName, email and password are required';
  }
  if (!EMAIL_RE.test(String(email).trim())) return 'Enter a valid email address';
  if (String(password).length < 8) return 'Password must be at least 8 characters';
  if (!isCollegeEmail(email, domains)) {
    return `Use your college email address (${domains.map((d) => `@${d}`).join(' or ')})`;
  }
  return null;
}

function validateNewUser({ fullName, email, password, role } = {}) {
  if (!fullName || !email || !password || !['STAFF', 'ADMIN'].includes(role)) {
    return 'fullName, email, password and role (STAFF or ADMIN) are required';
  }
  if (!EMAIL_RE.test(String(email).trim())) return 'Enter a valid email address';
  if (String(password).length < 8) return 'Password must be at least 8 characters';
  return null;
}

// Admin edits to a user. An admin may not demote or deactivate themselves,
// which would lock the last administrator out of the system.
function validateUserUpdate({ role, isActive } = {}, targetId, actorId) {
  if (role !== undefined && !ROLES.includes(role)) return 'role must be STUDENT, STAFF or ADMIN';
  if (isActive !== undefined && typeof isActive !== 'boolean') return 'isActive must be true or false';
  if (targetId === actorId && ((role && role !== 'ADMIN') || isActive === false)) {
    return 'You cannot remove your own admin access';
  }
  return null;
}

module.exports = { ROLES, parseDomains, isCollegeEmail, validateRegistration, validateNewUser, validateUserUpdate };
