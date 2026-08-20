const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');
const { validateCoupon } = require('../controllers/couponController');

router.get('/:code', authMiddleware, validateCoupon);

module.exports = router;
