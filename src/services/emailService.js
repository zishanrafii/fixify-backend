const nodemailer = require('nodemailer');

// .env এ লাগবে: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
// Gmail ব্যবহার করলে App Password লাগবে (নরমাল পাসওয়ার্ড কাজ করবে না)।
// কনফিগার না থাকলে sendEmail() শুধু কনসোলে লগ করবে।

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST) return null;

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_PORT === '465',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transporter;
}

async function sendEmail(to, subject, html) {
  if (!to) return;

  const t = getTransporter();
  if (!t) {
    console.log(`[Email not configured — would send to ${to}]: ${subject}`);
    return { skipped: true };
  }

  try {
    return await t.sendMail({ from: process.env.SMTP_FROM, to, subject, html });
  } catch (err) {
    console.error('Email send failed:', err.message);
    return { error: true };
  }
}

// Throws on failure — used by the notification worker for retry/backoff signaling.
async function sendEmailOrThrow(to, subject, html) {
  if (!to) {
    const err = new Error('No email address on file for this user');
    err.code = 'NO_ADDRESS';
    throw err;
  }

  const t = getTransporter();
  if (!t) {
    const err = new Error('SMTP is not configured');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }

  return t.sendMail({ from: process.env.SMTP_FROM, to, subject, html });
}

module.exports = { sendEmail, sendEmailOrThrow };
