const multer = require('multer');
const path = require('path');

// এখন স্থানীয় ডিস্কে সেভ হচ্ছে (uploads/ ফোল্ডারে)।
// প্রোডাকশনে multerS3 বা Firebase Storage দিয়ে রিপ্লেস করুন যাতে সার্ভার
// রিস্টার্ট/স্কেল-আউট এ ফাইল হারিয়ে না যায়।
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../../uploads')),
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new Error('শুধু JPEG, PNG বা WEBP ছবি আপলোড করা যাবে'), false);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// চ্যাটের অ্যাটাচমেন্টের জন্য — ছবি, ভয়েস নোট, ডকুমেন্ট সবই লাগবে, তাই wider mimetype list
const chatMediaFileFilter = (req, file, cb) => {
  const allowed = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'audio/mp4',
    'audio/mpeg',
    'audio/aac',
    'audio/wav',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new Error('এই ফাইল টাইপ সাপোর্টেড না'), false);
};

const uploadChatMedia = multer({
  storage,
  fileFilter: chatMediaFileFilter,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

module.exports = upload;
module.exports.uploadChatMedia = uploadChatMedia;
