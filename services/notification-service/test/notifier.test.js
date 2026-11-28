jest.mock('axios');
const axios = require('axios');
const { createNotifier, InvalidEventError } = require('../src/notifier');

// A fake pg pool that mimics the UNIQUE (event_id, user_id) constraint.
function fakePool() {
  const rows = [];
  return {
    rows,
    query: jest.fn(async (sql, params) => {
      if (sql.startsWith('INSERT INTO notification.notifications')) {
        const [eventId, userId] = params;
        if (rows.some((r) => r.event_id === eventId && r.user_id === userId)) return { rows: [] };
        const row = { id: `n${rows.length + 1}`, event_id: eventId, user_id: userId, message: params[4], email_sent: false };
        rows.push(row);
        return { rows: [{ id: row.id }] };
      }
      if (sql.startsWith('UPDATE notification.notifications SET email_sent')) {
        rows.find((r) => r.id === params[0]).email_sent = true;
        return { rows: [] };
      }
      if (sql.startsWith('SELECT')) return { rows: rows.filter((r) => r.user_id === params[0]) };
      if (sql.startsWith('UPDATE notification.notifications SET is_read')) {
        const r = rows.find((x) => x.id === params[0] && x.user_id === params[1]);
        return { rows: r ? [{ ...r, is_read: true }] : [] };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    }),
  };
}

const event = (overrides = {}) => ({
  eventId: 'e1', eventType: 'COMPLAINT_ASSIGNED', complaintId: 'c1', referenceNo: 'CMP-2026-000001',
  recipients: [{ userId: 'staff-1' }, { userId: 'stu-1' }], ...overrides,
});

beforeEach(() => {
  axios.get.mockReset();
  axios.get.mockImplementation(async (url) => ({ data: { email: `${url.split('/').pop()}@ccms.edu` } }));
});

describe('processEvent', () => {
  test('stores one notification per recipient and emails each of them', async () => {
    const pool = fakePool();
    const sendEmail = jest.fn().mockResolvedValue();
    const n = createNotifier({ pool, authServiceUrl: 'http://auth', sendEmail, log: jest.fn() });

    expect(await n.processEvent(event())).toBe(2);
    expect(pool.rows.map((r) => r.user_id)).toEqual(['staff-1', 'stu-1']);
    expect(sendEmail).toHaveBeenCalledWith('staff-1@ccms.edu', 'CCMS: CMP-2026-000001',
      'Complaint CMP-2026-000001 has been assigned to a staff member.');
    expect(pool.rows.every((r) => r.email_sent)).toBe(true);
  });

  test('a repeated delivery of the same event creates nothing and sends no email (idempotent)', async () => {
    const pool = fakePool();
    const sendEmail = jest.fn().mockResolvedValue();
    const n = createNotifier({ pool, authServiceUrl: 'http://auth', sendEmail, log: jest.fn() });
    await n.processEvent(event());
    sendEmail.mockClear();

    expect(await n.processEvent(event())).toBe(0);
    expect(pool.rows).toHaveLength(2);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test('an email failure is logged but does not fail the event', async () => {
    const pool = fakePool();
    const log = jest.fn();
    const sendEmail = jest.fn().mockRejectedValue(new Error('SES down'));
    const n = createNotifier({ pool, authServiceUrl: 'http://auth', sendEmail, log });

    expect(await n.processEvent(event({ recipients: [{ userId: 'stu-1' }] }))).toBe(1);
    expect(pool.rows[0].email_sent).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ level: 'warn', msg: 'email send failed' }));
  });

  test('without an email sender only in-app notifications are stored', async () => {
    const pool = fakePool();
    const n = createNotifier({ pool, authServiceUrl: 'http://auth' });
    expect(await n.processEvent(event({ eventType: 'COMPLAINT_SUBMITTED' }))).toBe(2);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('builds the right message for each event type', async () => {
    const pool = fakePool();
    const n = createNotifier({ pool, authServiceUrl: 'http://auth' });
    await n.processEvent(event({ eventId: 'a', eventType: 'COMPLAINT_SUBMITTED', recipients: [{ userId: 'u' }] }));
    await n.processEvent(event({
      eventId: 'b', eventType: 'COMPLAINT_STATUS_CHANGED', oldStatus: 'ASSIGNED', newStatus: 'IN_PROGRESS', recipients: [{ userId: 'u' }],
    }));
    await n.processEvent(event({ eventId: 'c', eventType: 'SOMETHING_NEW', recipients: [{ userId: 'u' }] }));
    expect(pool.rows.map((r) => r.message)).toEqual([
      'Your complaint CMP-2026-000001 has been submitted and is awaiting assignment.',
      'Complaint CMP-2026-000001 changed from ASSIGNED to IN_PROGRESS.',
      'Update on complaint CMP-2026-000001',
    ]);
  });

  test('rejects a malformed event', async () => {
    const n = createNotifier({ pool: fakePool(), authServiceUrl: 'http://auth' });
    await expect(n.processEvent({ eventType: 'X' })).rejects.toBeInstanceOf(InvalidEventError);
    await expect(n.processEvent(undefined)).rejects.toBeInstanceOf(InvalidEventError);
  });
});

describe('listForUser and markRead', () => {
  test('lists a user\'s notifications and marks one read, but not someone else\'s', async () => {
    const pool = fakePool();
    const n = createNotifier({ pool, authServiceUrl: 'http://auth' });
    await n.processEvent(event());

    expect((await n.listForUser('stu-1')).map((r) => r.user_id)).toEqual(['stu-1']);
    const id = pool.rows.find((r) => r.user_id === 'stu-1').id;
    expect(await n.markRead(id, 'staff-1')).toBeNull();
    expect((await n.markRead(id, 'stu-1')).is_read).toBe(true);
  });
});
