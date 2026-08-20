const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');
const { getMyCallHistory } = require('../controllers/callController');

router.get('/history', authMiddleware, getMyCallHistory);

module.exports = router;
