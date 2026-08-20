const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');
const upload = require('../middleware/upload');
const { uploadImages, uploadChatAttachment } = require('../controllers/uploadController');

router.post('/', authMiddleware, upload.array('images', 5), uploadImages);
router.post('/chat-media', authMiddleware, upload.uploadChatMedia.single('file'), uploadChatAttachment);

module.exports = router;
