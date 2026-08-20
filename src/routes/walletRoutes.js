const express = require('express');
const router = express.Router();
const { authMiddleware, blockGuest } = require('../middleware/authMiddleware');
const { getMyWallet, requestWithdrawal, getMyWithdrawals } = require('../controllers/walletController');

router.get('/me', authMiddleware, getMyWallet);
router.post('/withdraw', authMiddleware, blockGuest, requestWithdrawal);
router.get('/withdrawals/me', authMiddleware, getMyWithdrawals);

module.exports = router;
