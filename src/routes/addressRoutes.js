const express = require('express');
const router = express.Router();
const { authMiddleware, blockGuest } = require('../middleware/authMiddleware');
const { validate } = require('../middleware/validate');
const { createAddress, getMyAddresses, deleteAddress } = require('../controllers/addressController');
const { createAddressSchema } = require('../validators/bookingValidators');

router.post('/', authMiddleware, blockGuest, validate(createAddressSchema), createAddress);
router.get('/me', authMiddleware, getMyAddresses);
router.delete('/:id', authMiddleware, blockGuest, deleteAddress);

module.exports = router;
