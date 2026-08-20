const express = require('express');
const router = express.Router();
const { authMiddleware, requireRole } = require('../middleware/authMiddleware');
const {
  createJobPost,
  getNearbyJobPosts,
  getMyJobPosts,
  placeBid,
  getMyBids,
  acceptBid,
} = require('../controllers/jobController');

const customerOnly = [authMiddleware, requireRole('CUSTOMER')];
const providerOnly = [authMiddleware, requireRole('PROVIDER')];

router.post('/', customerOnly, createJobPost);
router.get('/mine', customerOnly, getMyJobPosts);
router.post('/bids/:bidId/accept', customerOnly, acceptBid);

router.get('/nearby', providerOnly, getNearbyJobPosts);
router.post('/bids', providerOnly, placeBid);
router.get('/bids/mine', providerOnly, getMyBids);

module.exports = router;
