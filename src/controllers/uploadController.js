const { success, error } = require('../utils/responseHandler');

// একাধিক ছবি আপলোড করে তাদের পাবলিক URL রিটার্ন করে
// (listing photos বা profile picture — দুটোতেই ব্যবহার করা যাবে)
function uploadImages(req, res) {
  if (!req.files || req.files.length === 0) {
    return error(res, 'কোনো ছবি পাওয়া যায়নি');
  }

  const baseUrl = `${process.env.APP_BASE_URL}/uploads`;
  const urls = req.files.map((file) => `${baseUrl}/${file.filename}`);

  return success(res, { urls }, 'ছবি আপলোড হয়েছে');
}

// চ্যাট অ্যাটাচমেন্ট (ছবি/ভয়েস নোট/ডকুমেন্ট) — একবারে একটা ফাইল, মেটাডেটাসহ রিটার্ন করে
function uploadChatAttachment(req, res) {
  if (!req.file) return error(res, 'কোনো ফাইল পাওয়া যায়নি');

  const baseUrl = `${process.env.APP_BASE_URL}/uploads`;
  return success(res, {
    url: `${baseUrl}/${req.file.filename}`,
    fileName: req.file.originalname,
    fileSizeBytes: req.file.size,
    mimeType: req.file.mimetype,
  });
}

module.exports = { uploadImages, uploadChatAttachment };
