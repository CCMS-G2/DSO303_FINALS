const v = require('../src/validation');

const domains = ['ccms.edu'];

describe('parseDomains', () => {
  test('splits, trims, lower-cases and drops a leading @', () => {
    expect(v.parseDomains(' CCMS.edu, @College.EDU ,')).toEqual(['ccms.edu', 'college.edu']);
  });
  test('empty input gives no domains', () => expect(v.parseDomains(undefined)).toEqual([]));
});

describe('isCollegeEmail (FR-01)', () => {
  test('accepts the college domain and its subdomains', () => {
    expect(v.isCollegeEmail('tashi@ccms.edu', domains)).toBe(true);
    expect(v.isCollegeEmail('Tashi@Student.CCMS.edu', domains)).toBe(true);
  });
  test('rejects other domains and look-alikes', () => {
    expect(v.isCollegeEmail('tashi@gmail.com', domains)).toBe(false);
    expect(v.isCollegeEmail('tashi@ccms.edu.evil.com', domains)).toBe(false);
    expect(v.isCollegeEmail('tashi@notccms.edu', domains)).toBe(false);
  });
  test('rejects malformed addresses', () => {
    expect(v.isCollegeEmail('not-an-email', domains)).toBe(false);
    expect(v.isCollegeEmail(undefined, domains)).toBe(false);
  });
});

describe('validateRegistration', () => {
  const ok = { fullName: 'Tashi', email: 'tashi@ccms.edu', password: 'Password123!' };
  test('valid student registration', () => expect(v.validateRegistration(ok, domains)).toBeNull());
  test('missing fields', () => {
    expect(v.validateRegistration({}, domains)).toMatch(/required/);
    expect(v.validateRegistration({ ...ok, fullName: '  ' }, domains)).toMatch(/required/);
  });
  test('bad email format', () => expect(v.validateRegistration({ ...ok, email: 'x@y' }, domains)).toMatch(/valid email/));
  test('short password', () => expect(v.validateRegistration({ ...ok, password: 'short' }, domains)).toMatch(/8 characters/));
  test('non-college email names the allowed domain', () => {
    expect(v.validateRegistration({ ...ok, email: 'tashi@gmail.com' }, domains)).toBe('Use your college email address (@ccms.edu)');
  });
});

describe('validateNewUser (admin creates staff/admin)', () => {
  const ok = { fullName: 'Sonam', email: 'sonam@ccms.edu', password: 'Password123!', role: 'STAFF' };
  test('valid', () => expect(v.validateNewUser(ok)).toBeNull());
  test('students cannot be created this way', () => expect(v.validateNewUser({ ...ok, role: 'STUDENT' })).toMatch(/STAFF or ADMIN/));
  test('bad email', () => expect(v.validateNewUser({ ...ok, email: 'nope' })).toMatch(/valid email/));
  test('short password', () => expect(v.validateNewUser({ ...ok, password: '123' })).toMatch(/8 characters/));
  test('no body', () => expect(v.validateNewUser()).toMatch(/required/));
});

describe('validateUserUpdate (FR-16)', () => {
  test('admin changes another user', () => {
    expect(v.validateUserUpdate({ role: 'STAFF' }, 'u2', 'u1')).toBeNull();
    expect(v.validateUserUpdate({ isActive: false }, 'u2', 'u1')).toBeNull();
  });
  test('unknown role or non-boolean isActive', () => {
    expect(v.validateUserUpdate({ role: 'BOSS' }, 'u2', 'u1')).toMatch(/role must be/);
    expect(v.validateUserUpdate({ isActive: 'no' }, 'u2', 'u1')).toMatch(/true or false/);
  });
  test('admin cannot lock themselves out', () => {
    expect(v.validateUserUpdate({ isActive: false }, 'u1', 'u1')).toMatch(/own admin access/);
    expect(v.validateUserUpdate({ role: 'STAFF' }, 'u1', 'u1')).toMatch(/own admin access/);
    expect(v.validateUserUpdate({ role: 'ADMIN' }, 'u1', 'u1')).toBeNull();
  });
  test('empty update is allowed (no-op)', () => expect(v.validateUserUpdate(undefined, 'u2', 'u1')).toBeNull());
});
