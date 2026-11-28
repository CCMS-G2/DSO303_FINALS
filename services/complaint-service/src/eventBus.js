const axios = require('axios');
const crypto = require('crypto');

// Two transports, chosen by environment:
//
//   AWS   (COMPLAINT_EVENTS_QUEUE_URL set): the event becomes an SQS message.
//         The notification Lambda is triggered by the queue; failed messages
//         are retried and then moved to the dead-letter queue.
//   Local (otherwise): an HTTP call to the Notification Service, which runs
//         the same processing logic.
//
// publishEvent() must never block or fail the caller's request: the complaint
// is already committed to the database by the time this runs (proposal,
// Section 14, "Reliability design for the event path").

const QUEUE_URL = process.env.COMPLAINT_EVENTS_QUEUE_URL;
const NOTIFICATION_URL = process.env.NOTIFICATION_URL || 'http://localhost:3002';

let sqs; let SendMessageCommand;
if (QUEUE_URL) {
  const sdk = require('@aws-sdk/client-sqs');
  SendMessageCommand = sdk.SendMessageCommand;
  // The SDK already retries transient errors with back-off; 3 attempts total.
  sqs = new sdk.SQSClient({ maxAttempts: 3 });
}

function publishEvent(type, payload) {
  const event = { eventId: crypto.randomUUID(), eventType: type, occurredAt: new Date().toISOString(), ...payload };

  const send = QUEUE_URL
    ? sqs.send(new SendMessageCommand({ QueueUrl: QUEUE_URL, MessageBody: JSON.stringify(event) }))
    : axios.post(`${NOTIFICATION_URL}/internal/events`, event);

  send.catch((err) => {
    console.error(JSON.stringify({
      level: 'error', msg: 'event publish failed', eventType: type, eventId: event.eventId, error: err.message,
    }));
  });
}

module.exports = { publishEvent };
