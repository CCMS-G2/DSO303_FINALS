// Notification logic shared by both runtimes:
//   - src/app.js    : local Express server (Docker Compose), events arrive over HTTP
//   - src/lambda.js : AWS Lambda, events arrive from SQS
// Only the transports differ (how events arrive, how email is sent).
const axios = require('axios');

const MESSAGES = {
  COMPLAINT_SUBMITTED: (p) => `Your complaint ${p.referenceNo} has been submitted and is awaiting assignment.`,
  COMPLAINT_ASSIGNED: (p) => `Complaint ${p.referenceNo} has been assigned to a staff member.`,
  COMPLAINT_STATUS_CHANGED: (p) => `Complaint ${p.referenceNo} changed from ${p.oldStatus} to ${p.newStatus}.`,
};

class InvalidEventError extends Error {}

/**
 * @param {object}   deps
 * @param {import('pg').Pool} deps.pool
 * @param {string}   deps.authServiceUrl   base URL of the Auth Service (for recipient email lookup)
 * @param {Function} [deps.sendEmail]      async (to, subject, text) => void; omit to skip email
 * @param {Function} [deps.log]            structured logger (object) => void
 */
function createNotifier({ pool, authServiceUrl, sendEmail, log = (o) => console.log(JSON.stringify(o)) }) {
  // Returns the number of new notifications stored (0 for a duplicate delivery).
  async function processEvent(event) {
    const { eventId, eventType, recipients, ...payload } = event || {};
    if (!eventId || !eventType || !Array.isArray(recipients)) {
      throw new InvalidEventError('eventId, eventType and recipients[] are required');
    }
    const message = (MESSAGES[eventType] || (() => `Update on complaint ${payload.referenceNo || ''}`))(payload);
    let created = 0;

    for (const r of recipients) {
      // (event_id, user_id) is UNIQUE: SQS delivers at least once, so a repeated
      // delivery of the same event for the same person is ignored here.
      const { rows } = await pool.query(
        `INSERT INTO notification.notifications (event_id, user_id, complaint_id, type, message)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (event_id, user_id) DO NOTHING RETURNING id`,
        [eventId, r.userId, payload.complaintId || null, eventType, message],
      );
      if (!rows[0]) continue;
      created += 1;
      if (!sendEmail) continue;

      // Email is best effort: a failure is recorded (email_sent stays false) but
      // does not fail the event, so one bad address cannot block the queue.
      try {
        const { data: user } = await axios.get(`${authServiceUrl}/internal/users/${r.userId}`, { timeout: 5000 });
        await sendEmail(user.email, `CCMS: ${payload.referenceNo || 'update'}`, message);
        await pool.query('UPDATE notification.notifications SET email_sent = true WHERE id = $1', [rows[0].id]);
      } catch (err) {
        log({ level: 'warn', msg: 'email send failed', eventId, userId: r.userId, error: err.message });
      }
    }
    return created;
  }

  async function listForUser(userId) {
    const { rows } = await pool.query(
      'SELECT * FROM notification.notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [userId],
    );
    return rows;
  }

  async function markRead(id, userId) {
    const { rows } = await pool.query(
      'UPDATE notification.notifications SET is_read = true WHERE id = $1 AND user_id = $2 RETURNING *', [id, userId],
    );
    return rows[0] || null;
  }

  return { processEvent, listForUser, markRead };
}

module.exports = { createNotifier, InvalidEventError };
