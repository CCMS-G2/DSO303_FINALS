const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const axios = require('axios');
const { Pool } = require('pg');
const { authenticate } = require('./middleware/auth');
const asyncHandler = require('./asyncHandler');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:3000';

// Local scaffold: SMTP via MailHog stands in for Amazon SES. The call shape
// (transporter.sendMail) is almost identical either way - swapping to SES
// means using @aws-sdk/client-sesv2 instead of nodemailer, or pointing
// nodemailer at SES's own SMTP interface.
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'localhost',
  port: Number(process.env.SMTP_PORT || 1025),
  secure: false,
});

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'notification-service' }));

const MESSAGES = {
  COMPLAINT_SUBMITTED: (p) => `Your complaint ${p.referenceNo} has been submitted and is awaiting assignment.`,
  COMPLAINT_ASSIGNED: (p) => `Complaint ${p.referenceNo} has been assigned to a staff member.`,
  COMPLAINT_STATUS_CHANGED: (p) => `Complaint ${p.referenceNo} changed from ${p.oldStatus} to ${p.newStatus}.`,
};

// ======================================================================
// Event intake. In AWS this handler's logic becomes the body of a Lambda
// function triggered by SQS (one invocation per batch of messages); the
// idempotency check below (event_id is UNIQUE) is exactly what protects
// against SQS's at-least-once delivery, as described in the proposal.
// ======================================================================
app.post('/internal/events', asyncHandler(async (req, res) => {
  const { eventId, eventType, recipients, ...payload } = req.body || {};
  if (!eventId || !eventType || !Array.isArray(recipients)) {
    return res.status(400).json({ error: 'eventId, eventType and recipients[] are required' });
  }
  const message = (MESSAGES[eventType] || (() => `Update on complaint ${payload.referenceNo || ''}`))(payload);

  for (const r of recipients) {
    try {
      const { rows } = await pool.query(
        `INSERT INTO notification.notifications (event_id, user_id, complaint_id, type, message)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (event_id) DO NOTHING RETURNING *`,
        [eventId, r.userId, payload.complaintId || null, eventType, message],
      );
      if (!rows[0]) continue; // duplicate delivery of the same event - already handled

      let emailSent = false;
      try {
        const { data: user } = await axios.get(`${AUTH_SERVICE_URL}/internal/users/${r.userId}`);
        await transporter.sendMail({
          from: 'CCMS <no-reply@ccms.edu>', to: user.email, subject: `CCMS: ${payload.referenceNo || 'update'}`, text: message,
        });
        emailSent = true;
      } catch (mailErr) {
        console.error('[notification-service] email send failed (would go to DLQ in AWS):', mailErr.message);
      }
      if (emailSent) {
        await pool.query('UPDATE notification.notifications SET email_sent = true WHERE id = $1', [rows[0].id]);
      }
    } catch (err) {
      console.error('[notification-service] failed to process recipient:', err.message);
    }
  }
  res.status(202).json({ received: true });
}));

// ---- Frontend-facing API ----

app.get('/api/notifications', authenticate, asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM notification.notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [req.user.sub],
  );
  res.json(rows);
}));

app.patch('/api/notifications/:id/read', authenticate, asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'UPDATE notification.notifications SET is_read = true WHERE id = $1 AND user_id = $2 RETURNING *',
    [req.params.id, req.user.sub],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Notification not found' });
  res.json(rows[0]);
}));

// Final error handler: anything thrown by an asyncHandler-wrapped route
// lands here as a JSON response instead of crashing the process.
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const port = process.env.PORT || 3002;
app.listen(port, () => console.log(`notification-service listening on ${port}`));
