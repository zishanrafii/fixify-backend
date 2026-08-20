const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');
const { permissionMiddleware } = require('../middleware/permissionMiddleware');
const { createDispute, getMyDisputes, listOpenDisputes, resolveDispute } = require('../controllers/disputeController');

router.post('/', authMiddleware, createDispute);
router.get('/mine', authMiddleware, getMyDisputes);

router.get('/open', authMiddleware, permissionMiddleware('disputes.view', 'Dispute'), listOpenDisputes);
router.patch('/:id/resolve', authMiddleware, permissionMiddleware('disputes.resolve', 'Dispute'), resolveDispute);

module.exports = router;
