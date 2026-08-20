const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');
const { createReview, getReviewsForProvider } = require('../controllers/reviewController');

router.post('/', authMiddleware, createReview);
router.get('/provider/:providerId', getReviewsForProvider);

module.exports = router;
