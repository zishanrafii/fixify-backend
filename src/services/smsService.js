const axios = require('axios');

// বাংলাদেশে bulksmsbd.net, ssl wireless এর মতো গেটওয়েগুলো সাধারণত এই একই ধরনের
// সিম্পল HTTP GET/POST API দেয়। এখানে bulksmsbd.net এর প্যাটার্ন ধরে লেখা হয়েছে —
// অন্য গেটওয়ে ব্যবহার করলে শুধু এই ফাইলের URL/params বদলালেই হবে, বাকি অ্যাপের
// কোথাও পরিবর্তন লাগবে না (sendSMS() ফাংশনটাই একমাত্র entry point)।
//
// .env এ লাগবে: SMS_API_KEY, SMS_SENDER_ID (গেটওয়ে থেকে পাওয়া)
// এই দুটো ছাড়া sendSMS() শুধু কনসোলে লগ করবে, এরর দিবে না — যাতে ডেভেলপমেন্টে
// পুরো booking/auth ফ্লো ভেঙে না যায়।

const SMS_API_URL = 'https://bulksmsbd.net/api/smsapi';

async function sendSMS(phone, message) {
  const apiKey = process.env.SMS_API_KEY;
  const senderId = process.env.SMS_SENDER_ID;

  if (!apiKey || !senderId) {
    console.log(`[SMS not configured — would send to ${phone}]: ${message}`);
    return { skipped: true };
  }

  try {
    const response = await axios.post(SMS_API_URL, {
      api_key: apiKey,
      senderid: senderId,
      number: phone,
      message,
    });
    return response.data;
  } catch (err) {
    console.error('SMS send failed:', err.message);
    return { error: true };
  }
}

// Throws on failure — used by the notification worker for retry/backoff signaling.
async function sendSMSOrThrow(phone, message) {
  const apiKey = process.env.SMS_API_KEY;
  const senderId = process.env.SMS_SENDER_ID;

  if (!phone) {
    const err = new Error('No phone number on file for this user');
    err.code = 'NO_ADDRESS';
    throw err;
  }
  if (!apiKey || !senderId) {
    const err = new Error('SMS gateway is not configured');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }

  const response = await axios.post(SMS_API_URL, { api_key: apiKey, senderid: senderId, number: phone, message });
  return response.data;
}

module.exports = { sendSMS, sendSMSOrThrow };
