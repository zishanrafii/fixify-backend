const { Queue } = require('bullmq');
const IORedis = require('ioredis');

// BullMQ needs its own dedicated, persistent Redis connection (it requires
// maxRetriesPerRequest: null) — this is separate from src/services/redisService.js,
// whose in-memory fallback logic doesn't make sense for a real queue: a queue
// backed by "sometimes in-memory" would lose jobs across every restart.
// Reliable queue-based notification delivery requires Redis to be actually
// configured — see docs/notification-module-design.md.
let connection = null;
if (process.env.REDIS_URL) {
  connection = new IORedis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null,
  });
} else {
  console.warn(
    '[notificationQueues] REDIS_URL not set — queue-based notification delivery is DISABLED. Notifications will be created in the DB but never enqueued for sending.'
  );
}

const CHANNELS = ['push', 'email', 'sms'];

const queues = {};
const dlqQueue = connection
  ? new Queue('notifications-dlq', { connection })
  : null;

if (connection) {
  for (const channel of CHANNELS) {
   const queueName = 'notifications-' + channel;
queues[channel] = new Queue(queueName, {
      connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { age: 7 * 24 * 60 * 60 },
        removeOnFail: false,
      },
    });
  }
}

function isQueueingEnabled() {
  return connection !== null;
}

async function enqueueNotificationJob(channel, notificationId, delay = 0) {
  if (!isQueueingEnabled()) return null;

  const queue = queues[channel];
  if (!queue) {
   throw new Error('Unknown notification channel: ' + channel);
  }

  return queue.add(
    channel,
    { notificationId, channel },
    { delay }
  );
}

module.exports = {
  queues,
  dlqQueue,
  connection,
  CHANNELS,
  isQueueingEnabled,
  enqueueNotificationJob,
};
