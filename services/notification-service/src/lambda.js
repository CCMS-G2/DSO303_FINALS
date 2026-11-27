// AWS runtime for the Notification Service: two Lambda handlers in one package.
//
//   consumer : triggered by the SQS complaint-events queue. Reports partial batch
//              failures, so only failed messages are retried; after 3 failed
//              receives SQS moves a message to the dead-letter queue.
//   api      : behind API Gateway (HTTP API, payload v2) for
//              GET /api/notifications and PATCH /api/notifications/{id}/read.
//
// The AWS SDK v3 clients used here are provided by the Lambda Node.js runtime.
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');
const { createNotifier } = require('./notifier');

const log = (o) => console.log(JSON.stringify(o));

// Secrets are read once per cold start and reused by later invocations.
let ctxPromise;
function getContext() {
  if (!ctxPromise) {
    ctxPromise = (async () => {
      const sm = new SecretsManagerClient({});
      const read = async (id) => (await sm.send(new GetSecretValueCommand({ SecretId: id }))).SecretString;
      const [dbSecret, jwtSecret] = await Promise.all([read(process.env.DB_SECRET_ARN), read(process.env.JWT_SECRET_ARN)]);

      const pool = new Pool({ connectionString: JSON.parse(dbSecret).url, max: 2 });
      const sender = process.env.SES_SENDER;
      const ses = sender ? new SESv2Client({}) : null;
      const sendEmail = ses && ((to, subject, text) => ses.send(new SendEmailCommand({
        FromEmailAddress: sender,
        Destination: { ToAddresses: [to] },
        Content: { Simple: { Subject: { Data: subject }, Body: { Text: { Data: text } } } },
      })));

      const notifier = createNotifier({ pool, authServiceUrl: process.env.AUTH_SERVICE_URL, sendEmail, log });
      return { notifier, jwtSecret };
    })().catch((err) => { ctxPromise = undefined; throw err; });
  }
  return ctxPromise;
}

// CloudWatch Embedded Metric Format: this log line becomes the custom metric
// CCMS/NotificationsSent without any PutMetricData call.
function emitNotificationsMetric(count) {
  console.log(JSON.stringify({
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [{ Namespace: 'CCMS', Dimensions: [[]], Metrics: [{ Name: 'NotificationsSent', Unit: 'Count' }] }],
    },
    NotificationsSent: count,
  }));
}

exports.consumer = async (event) => {
  const { notifier } = await getContext();
  const batchItemFailures = [];
  let sent = 0;

  for (const record of event.Records) {
    try {
      // Demo scenario 6: set simulate_notification_failure = true in Terraform
      // to watch messages retry, land in the DLQ and trigger the alarm.
      if (process.env.SIMULATE_FAILURE === 'true') throw new Error('Simulated failure (SIMULATE_FAILURE=true)');
      const body = JSON.parse(record.body);
      sent += await notifier.processEvent(body);
      log({ level: 'info', msg: 'event processed', messageId: record.messageId, eventId: body.eventId, eventType: body.eventType });
    } catch (err) {
      log({ level: 'error', msg: 'event failed', messageId: record.messageId, error: err.message });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  if (sent) emitNotificationsMetric(sent);
  return { batchItemFailures };
};

const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

exports.api = async (event) => {
  const { notifier, jwtSecret } = await getContext();

  const header = (event.headers && event.headers.authorization) || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return json(401, { error: 'Missing bearer token' });
  let user;
  try {
    user = jwt.verify(token, jwtSecret);
  } catch (_err) {
    return json(401, { error: 'Invalid or expired token' });
  }

  const method = event.requestContext.http.method;
  try {
    if (method === 'GET' && event.rawPath === '/api/notifications') {
      return json(200, await notifier.listForUser(user.sub));
    }
    const id = event.pathParameters && event.pathParameters.id;
    if (method === 'PATCH' && id) {
      const row = await notifier.markRead(id, user.sub);
      return row ? json(200, row) : json(404, { error: 'Notification not found' });
    }
    return json(404, { error: 'Not found' });
  } catch (err) {
    log({ level: 'error', msg: 'notification api failed', requestId: event.requestContext.requestId, error: err.message });
    return json(500, { error: 'Internal server error' });
  }
};
