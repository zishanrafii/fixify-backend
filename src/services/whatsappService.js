const axios = require('axios');

// Meta এর official WhatsApp Cloud API ব্যবহার করা হয়েছে (whatsapp-business হোস্টেড
// থার্ড-পার্টি গেটওয়ে না, সরাসরি Meta এর API)। সেটআপ করতে হবে:
//   1. https://developers.facebook.com এ একটা Meta App বানান, WhatsApp product যোগ করুন
//   2. টেস্ট নাম্বার বা নিজের বিজনেস নাম্বার ভেরিফাই করুন
//   3. .env এ বসান: WHATSAPP_TOKEN (access token), WHATSAPP_PHONE_NUMBER_ID
//   4. প্রোডাকশনে টেমপ্লেট মেসেজ Meta থেকে আগে থেকে অনুমোদিত করাতে হবে (২৪ ঘণ্টার
//      সেশন উইন্ডোর বাইরে ফ্রি-ফর্ম টেক্সট পাঠানো যায় না — এটা WhatsApp এর নিয়ম)
//
// কনফিগার না থাকলে sendWhatsAppMessage() শুধু কনসোলে লগ করবে।

const WHATSAPP_API_BASE = 'https://graph.facebook.com/v19.0';

async function sendWhatsAppMessage(phone, message) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    console.log(`[WhatsApp not configured — would send to ${phone}]: ${message}`);
    return { skipped: true };
  }

  try {
    const response = await axios.post(
      `${WHATSAPP_API_BASE}/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'text',
        text: { body: message },
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    return response.data;
  } catch (err) {
    console.error('WhatsApp send failed:', err.response?.data || err.message);
    return { error: true };
  }
}

module.exports = { sendWhatsAppMessage };
