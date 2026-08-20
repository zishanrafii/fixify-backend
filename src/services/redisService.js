const Redis = require('ioredis');

// ---------------------------------------------------------------------------
// Central Redis client for the whole backend. Any module needing shared,
// TTL-aware storage (OTP, rate limiting, and later Wallet locks, Booking
// holds, Notification dedupe, generic caching, etc.) should go through this
// service instead of opening its own connection or keeping local state.
//
// If REDIS_URL isn't set, or the connection fails/drops, this service
// transparently falls back to an in-memory store with the same TTL
// semantics, so the app keeps working on a single instance without Redis
// configured (e.g. local dev). That fallback does NOT work correctly across
// multiple instances/processes — see the "graceful fallback" note in
// isUsingRedis() below.
// ---------------------------------------------------------------------------

const memoryStore = new Map(); // key -> { value, expiresAt|null }

let client = null;
let isConnected = false;

function log(...args) {
  console.log('[RedisService]', ...args);
}

function init() {
  const url = process.env.REDIS_URL;
  if (!url) {
    log('REDIS_URL not set — using in-memory fallback store (single-instance only).');
    return;
  }

  client = new Redis(url, {
    // Keep retrying quietly in the background instead of crashing the app;
    // every call below already has its own try/catch fallback to memory.
    maxRetriesPerRequest: 1,
    retryStrategy: (times) => Math.min(times * 200, 5000),
    lazyConnect: false,
  });

  client.on('connect', () => {
    isConnected = true;
    log('Connected to Redis.');
  });

  client.on('error', (err) => {
    if (isConnected) log('Redis error, falling back to in-memory store:', err.message);
    isConnected = false;
  });

  client.on('close', () => {
    isConnected = false;
  });
}

init();

function isUsingRedis() {
  return isConnected;
}

// --- in-memory fallback helpers -------------------------------------------

function memGet(key) {
  const entry = memoryStore.get(key);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt < Date.now()) {
    memoryStore.delete(key);
    return null;
  }
  return entry.value;
}

function memSet(key, value, ttlSeconds) {
  const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
  memoryStore.set(key, { value, expiresAt });
}

function memDel(key) {
  memoryStore.delete(key);
}

function memIncrWithTTL(key, ttlSeconds) {
  const existing = memGet(key);
  const next = (existing ? parseInt(existing, 10) : 0) + 1;
  if (existing === null) {
    memSet(key, String(next), ttlSeconds);
  } else {
    // preserve remaining TTL — don't reset the expiry on every increment
    const entry = memoryStore.get(key);
    memoryStore.set(key, { value: String(next), expiresAt: entry.expiresAt });
  }
  return next;
}

// --- public API --------------------------------------------------------

async function get(key) {
  if (isConnected) {
    try {
      return await client.get(key);
    } catch (err) {
      log(`get(${key}) failed, using memory fallback:`, err.message);
    }
  }
  return memGet(key);
}

async function set(key, value, ttlSeconds) {
  if (isConnected) {
    try {
      if (ttlSeconds) await client.set(key, value, 'EX', ttlSeconds);
      else await client.set(key, value);
      return;
    } catch (err) {
      log(`set(${key}) failed, using memory fallback:`, err.message);
    }
  }
  memSet(key, value, ttlSeconds);
}

async function del(key) {
  if (isConnected) {
    try {
      await client.del(key);
      return;
    } catch (err) {
      log(`del(${key}) failed, using memory fallback:`, err.message);
    }
  }
  memDel(key);
}

// Atomically increments a counter and sets its TTL only the first time it's
// created (so repeated calls within the window don't keep extending it).
// Used for OTP attempt counts and can be reused for any other rate-style
// counter.
async function incrWithTTL(key, ttlSeconds) {
  if (isConnected) {
    try {
      const count = await client.incr(key);
      if (count === 1) await client.expire(key, ttlSeconds);
      return count;
    } catch (err) {
      log(`incrWithTTL(${key}) failed, using memory fallback:`, err.message);
    }
  }
  return memIncrWithTTL(key, ttlSeconds);
}

// Escape hatch for libraries that need a real Redis client (e.g.
// rate-limit-redis's sendCommand interface). Returns null when Redis isn't
// connected — callers must handle that by using their own in-memory
// fallback (see src/middleware/rateLimiter.js for the pattern).
function getRawClient() {
  return isConnected ? client : null;
}

// Graceful shutdown: closes the connection cleanly (in-flight commands
// finish first) instead of letting the process exit yank it. No-op if
// Redis was never configured/connected.
async function quit() {
  if (client) {
    await client.quit().catch(() => {});
  }
}

module.exports = { get, set, del, incrWithTTL, isUsingRedis, getRawClient, quit };
