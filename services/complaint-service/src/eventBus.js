const axios = require('axios');
const crypto = require('crypto');

const NOTIFICATION_URL = process.env.NOTIFICATION_URL || 'http://localhost:3002';

// Local scaffold: publishing an event is an HTTP call to the Notification
// Service. In AWS this function's body becomes a single SQS call instead:
//
//   const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
//   const sqs = new SQSClient({});
//   await sqs.send(new SendMessageCommand({
//     QueueUrl: process.env.COMPLAINT_EVENTS_QUEUE_URL,
//     MessageBody: JSON.stringify({ eventId, eventType: type, occurredAt, ...payload }),
//   }));
//
// Nothing that calls publishEvent() needs to change when you make that swap.
//
// This also must never block or fail the caller's request: the complaint is
// already committed to the database by the time this runs (see proposal,
// Section 14, "Reliability design for the event path").
function publishEvent(type, payload) {
  const eventId = crypto.randomUUID();
  axios
    .post(`${NOTIFICATION_URL}/internal/events`, { eventId, eventType: type, occurredAt: new Date().toISOString(), ...payload })
    .catch((err) => {
      // In AWS, a failed SendMessage would be retried by the SDK and,
      // after repeated failures, the message would land in a dead-letter
      // queue. Locally we just log it - nothing else depends on it.
      console.error(`[eventBus] failed to publish ${type} (would retry via SQS in AWS):`, err.message);
    });
}

module.exports = { publishEvent };
