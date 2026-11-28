// Local runtime for the Notification Service (Docker Compose).
// On AWS the same logic (src/notifier.js) runs in two Lambda functions instead;
// see src/lambda.js.
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const { Pool } = require('pg');
const { authenticate } = require('./middleware/auth');
const asyncHandler = require('./asyncHandler');
const { createNotifier, InvalidEventError } = require('./notifier');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// MailHog stands in for Amazon SES locally.
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'localhost',
  port: Number(process.env.SMTP_PORT || 1025),
  secure: false,
});

const notifier = createNotifier({
  pool,
  authServiceUrl: process.env.AUTH_SERVICE_URL || 'http://localhost:3000',
  sendEmail: (to, subject, text) => transporter.sendMail({ from: 'CCMS <no-reply@ccms.edu>', to, subject, text }),
});

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'notification-service' }));

// Event intake. On AWS, SQS delivers these to the consumer Lambda instead.
app.post('/internal/events', asyncHandler(async (req, res) => {
  try {
    await notifier.processEvent(req.body);
  } catch (err) {
    if (err instanceof InvalidEventError) return res.status(400).json({ error: err.message });
    throw err;
  }
  res.status(202).json({ received: true });
}));

// ---- Frontend-facing API ----

app.get('/api/notifications', authenticate, asyncHandler(async (req, res) => {
  res.json(await notifier.listForUser(req.user.sub));
}));

app.patch('/api/notifications/:id/read', authenticate, asyncHandler(async (req, res) => {
  const row = await notifier.markRead(req.params.id, req.user.sub);
  if (!row) return res.status(404).json({ error: 'Notification not found' });
  res.json(row);
}));

// Final error handler: anything thrown by an asyncHandler-wrapped route
// lands here as a JSON response instead of crashing the process.
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const port = process.env.PORT || 3002;
app.listen(port, () => console.log(`notification-service listening on ${port}`));
