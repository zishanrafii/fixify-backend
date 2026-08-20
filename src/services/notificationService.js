const { admin, initFirebase } = require('../config/firebase');

// একজন নির্দিষ্ট ইউজারকে (fcmToken দিয়ে) push notification পাঠায়।
// টোকেন না থাকলে বা Firebase init না হলে চুপচাপ স্কিপ করে — booking/message
// ফ্লো যেন কখনো নোটিফিকেশনের কারণে ব্যর্থ না হয়।
async function sendPushNotification(fcmToken, title, body, data = {}) {
  if (!fcmToken) return;

  initFirebase();
  if (!admin.apps.length) return;

  try {
    await admin.messaging().send({
      token: fcmToken,
      notification: { title, body },
      data,
    });
  } catch (err) {
    console.error('Push notification failed:', err.message);
  }
}

// Throws on failure (unlike sendPushNotification above) — used by the
// notification worker, which needs a real success/failure signal to drive
// BullMQ retry/backoff and to distinguish "invalid token" from other errors.
const STALE_TOKEN_ERROR_CODES = ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'];

async function sendPushNotificationOrThrow(fcmToken, title, body, data = {}) {
  if (!fcmToken) {
    const err = new Error('No FCM token on file for this user');
    err.code = 'NO_TOKEN';
    throw err;
  }

  initFirebase();
  if (!admin.apps.length) {
    const err = new Error('Firebase is not configured');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }

  try {
    const messageId = await admin.messaging().send({ token: fcmToken, notification: { title, body }, data });
    return { messageId };
  } catch (err) {
    if (STALE_TOKEN_ERROR_CODES.includes(err.code)) {
      const staleErr = new Error('FCM token is no longer valid');
      staleErr.code = 'STALE_TOKEN';
      throw staleErr;
    }
    throw err;
  }
}

module.exports = { sendPushNotification, sendPushNotificationOrThrow };
