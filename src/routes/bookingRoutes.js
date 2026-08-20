const express = require('express');
const router = express.Router();
const { authMiddleware, blockGuest } = require('../middleware/authMiddleware');
const { validate } = require('../middleware/validate');
const {
  createBooking,
  acceptBooking,
  rejectBooking,
  startBooking,
  providerMarkDone,
  customerConfirmComplete,
  cancelBooking,
  rescheduleBooking,
  getMyBookings,
  getBookingById,
} = require('../controllers/bookingController');
const {
  createBookingSchema,
  cancelBookingSchema,
  rescheduleBookingSchema,
} = require('../validators/bookingValidators');

router.post('/', authMiddleware, blockGuest, validate(createBookingSchema), createBooking);
router.get('/me', authMiddleware, getMyBookings);
router.get('/:id', authMiddleware, getBookingById);

router.patch('/:id/accept', authMiddleware, acceptBooking);
router.patch('/:id/reject', authMiddleware, rejectBooking);
router.patch('/:id/start', authMiddleware, startBooking);
router.patch('/:id/provider-done', authMiddleware, providerMarkDone);
router.patch('/:id/confirm-complete', authMiddleware, customerConfirmComplete);
router.patch('/:id/cancel', authMiddleware, validate(cancelBookingSchema), cancelBooking);
router.patch('/:id/reschedule', authMiddleware, validate(rescheduleBookingSchema), rescheduleBooking);
// Disputes: use POST /api/disputes { bookingId, reason, description } — see disputeController.js

module.exports = router;
