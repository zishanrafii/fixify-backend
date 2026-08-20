require('dotenv').config();
const http = require('http');
const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const IORedis = require('ioredis');

const app = require('./src/app');
const prisma = require('./src/config/db');
const redisService = require('./src/services/redisService');
const registerChatSocket = require('./src/sockets/chatSocket');
const registerCallSignaling = require('./src/sockets/callSignaling');
const { startBookingExpiryJob } = require('./src/jobs/bookingExpiryJob');
const { startReconciliationJob } = require('./src/jobs/paymentReconciliationJob');
const { startNotificationWorkers } = require('./src/workers/notificationWorker');
const { startDailyMetricsSnapshotJob } = require('./src/jobs/dailyMetricsSnapshotJob');
const { startChatLifecycleJob } = require('./src/jobs/chatLifecycleJob');
const notificationQueues = require('./src/queues/notificationQueues');

const PORT = process.env.PORT || 5000;

const server = http.createServer(app);

// Mirrors the same whitelist used for the HTTP API in src/app.js.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const io = new Server(server, {
  cors: { origin: allowedOrigins.length ? allowedOrigins : '*' },
});

// Declared here (not inside the `if` below) so the shutdown handler can
// reach them to close cleanly.
let socketIoPubClient = null;
let socketIoSubClient = null;

// Horizontal scaling: without this, Socket.IO rooms only work within a
// single process — a message sent on instance A would never reach a
// recipient connected to instance B. Skipped gracefully if Redis isn't
// configured (single-instance still works fine without it).
if (process.env.REDIS_URL) {
  socketIoPubClient = new IORedis(process.env.REDIS_URL);
  socketIoSubClient = socketIoPubClient.duplicate();
  io.adapter(createAdapter(socketIoPubClient, socketIoSubClient));
  console.log('[socket.io] Redis adapter attached (horizontal scaling enabled)');
} else {
  console.warn('[socket.io] REDIS_URL not set — running single-instance only (no cross-instance room delivery)');
}

app.set('io', io); // lets REST controllers (chatController.js) broadcast alongside socket-originated sends

registerChatSocket(io);
registerCallSignaling(io);

// Holds everything the shutdown handler needs to stop cleanly. Populated
// once each component actually starts, so shutdown never touches something
// that was never running.
const runningJobs = [];
let notificationWorkers = [];

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  runningJobs.push(startBookingExpiryJob());
  runningJobs.push(startReconciliationJob());
  notificationWorkers = startNotificationWorkers();
  runningJobs.push(startDailyMetricsSnapshotJob());
  runningJobs.push(startChatLifecycleJob());
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
// On SIGTERM (sent by most process managers/containers on deploy/restart) or
// SIGINT (Ctrl+C locally): stop taking new work, let in-flight work finish,
// then close every long-lived connection this process actually opened —
// only the ones above, nothing hypothetical. A hard-exit timeout guards
// against anything hanging indefinitely.
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return; // ignore a second SIGTERM/SIGINT while already draining
  shuttingDown = true;
  console.log(`[shutdown] ${signal} received, starting graceful shutdown...`);

  // Force-exit if graceful shutdown hangs, so a stuck connection can't block
  // a deploy/restart forever.
  const forceExitTimer = setTimeout(() => {
    console.error('[shutdown] did not finish within 15s, forcing exit.');
    process.exit(1);
  }, 15000);
  forceExitTimer.unref();

  try {
    // 1. Stop cron jobs first so no new job runs mid-shutdown.
    for (const task of runningJobs) {
      if (task && typeof task.stop === 'function') task.stop();
    }

    // 2. Stop accepting new HTTP connections; existing requests already
    //    in flight are allowed to finish (server.close() waits for them).
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    console.log('[shutdown] HTTP server closed.');

    // 3. Close Socket.IO (disconnects remaining sockets) and its Redis
    //    adapter connections, if they were opened.
    await new Promise((resolve) => io.close(() => resolve()));
    if (socketIoPubClient) await socketIoPubClient.quit().catch(() => {});
    if (socketIoSubClient) await socketIoSubClient.quit().catch(() => {});
    console.log('[shutdown] Socket.IO closed.');

    // 4. Close BullMQ workers (finishes/returns in-flight jobs cleanly
    //    instead of leaving them stuck "active"), then the queues and their
    //    dedicated Redis connection. All no-ops if Redis was never configured.
    await Promise.all(notificationWorkers.map((w) => w.close()));
    await Promise.all(Object.values(notificationQueues.queues).map((q) => q.close()));
    if (notificationQueues.dlqQueue) await notificationQueues.dlqQueue.close();
    if (notificationQueues.connection) await notificationQueues.connection.quit().catch(() => {});
    console.log('[shutdown] Notification workers/queues closed.');

    // 5. Disconnect the shared Prisma client and the shared app-wide Redis
    //    client (OTP/rate-limiting) last, once nothing above needs them.
    await prisma.$disconnect();
    await redisService.quit();
    console.log('[shutdown] Prisma and Redis disconnected.');

    clearTimeout(forceExitTimer);
    console.log('[shutdown] Complete.');
    process.exit(0);
  } catch (err) {
    console.error('[shutdown] Error during shutdown:', err);
    clearTimeout(forceExitTimer);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
