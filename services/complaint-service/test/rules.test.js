const rules = require('../src/rules');

const student = { sub: 'stu-1', role: 'STUDENT' };
const otherStudent = { sub: 'stu-2', role: 'STUDENT' };
const staff = { sub: 'staff-1', role: 'STAFF' };
const otherStaff = { sub: 'staff-2', role: 'STAFF' };
const admin = { sub: 'adm-1', role: 'ADMIN' };
const complaint = (status) => ({ status, student_id: 'stu-1', assigned_staff_id: 'staff-1' });

describe('canView (ownership checks)', () => {
  test('admin sees every complaint', () => expect(rules.canView(admin, complaint('SUBMITTED'))).toBe(true));
  test('student sees only their own', () => {
    expect(rules.canView(student, complaint('SUBMITTED'))).toBe(true);
    expect(rules.canView(otherStudent, complaint('SUBMITTED'))).toBe(false);
  });
  test('staff sees only assigned complaints', () => {
    expect(rules.canView(staff, complaint('ASSIGNED'))).toBe(true);
    expect(rules.canView(otherStaff, complaint('ASSIGNED'))).toBe(false);
  });
  test('unknown role sees nothing', () => expect(rules.canView({ role: 'GUEST' }, complaint('SUBMITTED'))).toBe(false));
});

describe('canAssign', () => {
  test.each(['SUBMITTED', 'ASSIGNED', 'IN_PROGRESS'])('%s can be (re)assigned', (s) => expect(rules.canAssign(s)).toBe(true));
  test.each(['RESOLVED', 'CLOSED'])('%s cannot be assigned', (s) => expect(rules.canAssign(s)).toBe(false));
});

describe('checkStatusChange (lifecycle and role rules)', () => {
  test('assigned staff starts work', () => {
    expect(rules.checkStatusChange(staff, complaint('ASSIGNED'), 'IN_PROGRESS')).toEqual({ ok: true });
  });
  test('other staff cannot start work on it (403)', () => {
    expect(rules.checkStatusChange(otherStaff, complaint('ASSIGNED'), 'IN_PROGRESS').code).toBe(403);
  });
  test('resolving needs a note (400)', () => {
    expect(rules.checkStatusChange(staff, complaint('IN_PROGRESS'), 'RESOLVED', '').code).toBe(400);
    expect(rules.checkStatusChange(staff, complaint('IN_PROGRESS'), 'RESOLVED', '   ').code).toBe(400);
    expect(rules.checkStatusChange(staff, complaint('IN_PROGRESS'), 'RESOLVED', 'Fixed').ok).toBe(true);
  });
  test('owner or admin may close a resolved complaint', () => {
    expect(rules.checkStatusChange(student, complaint('RESOLVED'), 'CLOSED').ok).toBe(true);
    expect(rules.checkStatusChange(admin, complaint('RESOLVED'), 'CLOSED').ok).toBe(true);
    expect(rules.checkStatusChange(otherStudent, complaint('RESOLVED'), 'CLOSED').code).toBe(403);
    expect(rules.checkStatusChange(staff, complaint('RESOLVED'), 'CLOSED').code).toBe(403);
  });
  test('skipping steps is rejected (409)', () => {
    expect(rules.checkStatusChange(staff, complaint('SUBMITTED'), 'RESOLVED', 'x').code).toBe(409);
    expect(rules.checkStatusChange(admin, complaint('CLOSED'), 'IN_PROGRESS').code).toBe(409);
  });
  test('assignment moves are not allowed through the status endpoint (409)', () => {
    expect(rules.checkStatusChange(admin, complaint('SUBMITTED'), 'ASSIGNED').code).toBe(409);
  });
  test('a student cannot resolve their own complaint (403)', () => {
    expect(rules.checkStatusChange(student, complaint('IN_PROGRESS'), 'RESOLVED', 'done').code).toBe(403);
  });
});

describe('canAddNote', () => {
  test('assigned staff and admin may add notes', () => {
    expect(rules.canAddNote(staff, complaint('IN_PROGRESS'))).toBe(true);
    expect(rules.canAddNote(admin, complaint('IN_PROGRESS'))).toBe(true);
  });
  test('students and other staff may not', () => {
    expect(rules.canAddNote(student, complaint('IN_PROGRESS'))).toBe(false);
    expect(rules.canAddNote(otherStaff, complaint('IN_PROGRESS'))).toBe(false);
  });
});

describe('referenceNumber', () => {
  test('pads to six digits', () => expect(rules.referenceNumber(2026, 123)).toBe('CMP-2026-000123'));
});

describe('checkUploadRequest (FR-04)', () => {
  test('accepts a JPEG under 5 MB', () => {
    expect(rules.checkUploadRequest('image/jpeg', 1000)).toEqual({ ok: true, bytes: 1000, ext: 'jpg' });
  });
  test('PNG gets a png extension', () => expect(rules.checkUploadRequest('image/png', 10).ext).toBe('png'));
  test('rejects other types', () => expect(rules.checkUploadRequest('image/gif', 10).ok).toBe(false));
  test('rejects missing or invalid size', () => {
    expect(rules.checkUploadRequest('image/png').ok).toBe(false);
    expect(rules.checkUploadRequest('image/png', -1).ok).toBe(false);
    expect(rules.checkUploadRequest('image/png', 1.5).ok).toBe(false);
  });
  test('rejects files over 5 MB', () => {
    expect(rules.checkUploadRequest('image/png', rules.MAX_IMAGE_BYTES).ok).toBe(true);
    expect(rules.checkUploadRequest('image/png', rules.MAX_IMAGE_BYTES + 1).ok).toBe(false);
  });
});

describe('checkImageKeys', () => {
  const key = (n) => `uploads/stu-1/${n}.jpg`;
  test('no images is fine', () => {
    expect(rules.checkImageKeys(undefined, 'stu-1')).toEqual({ ok: true, keys: [] });
    expect(rules.checkImageKeys(null, 'stu-1').keys).toEqual([]);
  });
  test('up to three of the student\'s own keys', () => {
    expect(rules.checkImageKeys([key(1), key(2), key(3)], 'stu-1').ok).toBe(true);
  });
  test('more than three is rejected', () => {
    expect(rules.checkImageKeys([key(1), key(2), key(3), key(4)], 'stu-1').ok).toBe(false);
  });
  test('someone else\'s key or a path trick is rejected', () => {
    expect(rules.checkImageKeys(['uploads/stu-2/a.jpg'], 'stu-1').ok).toBe(false);
    expect(rules.checkImageKeys(['uploads/stu-1/../stu-2/a.jpg'], 'stu-1').ok).toBe(false);
    expect(rules.checkImageKeys([42], 'stu-1').ok).toBe(false);
  });
  test('must be an array', () => expect(rules.checkImageKeys('uploads/stu-1/a.jpg', 'stu-1').ok).toBe(false));
});

describe('buildListFilter (FR-05, FR-14)', () => {
  test('student is always scoped to their own complaints', () => {
    const f = rules.buildListFilter(student, { status: 'SUBMITTED' });
    expect(f.where).toBe('WHERE student_id = $1 AND status = $2');
    expect(f.params).toEqual(['stu-1', 'SUBMITTED']);
  });
  test('staff is scoped to assigned complaints and cannot use the staff filter', () => {
    const f = rules.buildListFilter(staff, { staff: 'staff-2' });
    expect(f.where).toBe('WHERE assigned_staff_id = $1');
    expect(f.params).toEqual(['staff-1']);
  });
  test('admin can combine every filter, with a table alias', () => {
    const f = rules.buildListFilter(admin, {
      status: 'ASSIGNED', category: '2', location: '3', staff: 'staff-1', from: '2026-11-01', to: '2026-11-30',
    }, 'x');
    expect(f.where).toBe('WHERE x.status = $1 AND x.category_id = $2 AND x.location_id = $3'
      + ' AND x.assigned_staff_id = $4 AND x.created_at >= $5::date'
      + " AND x.created_at < $6::date + interval '1 day'");
    expect(f.params).toEqual(['ASSIGNED', 2, 3, 'staff-1', '2026-11-01', '2026-11-30']);
  });
  test('admin with no filters sees everything', () => {
    expect(rules.buildListFilter(admin)).toEqual({ where: '', params: [] });
  });
  test('rejects an unknown status or a bad date', () => {
    expect(rules.buildListFilter(admin, { status: 'DONE' }).error).toBeDefined();
    expect(rules.buildListFilter(admin, { from: 'yesterday' }).error).toBeDefined();
    expect(rules.buildListFilter(admin, { to: 'soon' }).error).toBeDefined();
  });
});
