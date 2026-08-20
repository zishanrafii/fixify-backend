const express = require('express');
const router = express.Router();
const { authMiddleware, requireRole, blockGuest } = require('../middleware/authMiddleware');
const { validate } = require('../middleware/validate');
const {
  upsertProfile,
  getMyProfile,
  createListing,
  getMyListings,
  updateListing,
  deleteListing,
  addCertificate,
  deleteCertificate,
  addEducation,
  deleteEducation,
} = require('../controllers/providerController');
const {
  setWeeklyAvailability,
  getMyWeeklyAvailability,
  getAvailableSlots,
} = require('../controllers/availabilityController');
const {
  upsertProviderProfileSchema,
  certificateSchema,
  educationSchema,
  createListingSchema,
  updateListingSchema,
} = require('../validators/providerValidators');

const providerOnly = [authMiddleware, blockGuest, requireRole('PROVIDER')];

router.post('/profile', providerOnly, validate(upsertProviderProfileSchema), upsertProfile);
router.get('/profile/me', providerOnly, getMyProfile);

router.post('/certificates', providerOnly, validate(certificateSchema), addCertificate);
router.delete('/certificates/:id', providerOnly, deleteCertificate);

router.post('/education', providerOnly, validate(educationSchema), addEducation);
router.delete('/education/:id', providerOnly, deleteEducation);

router.put('/availability', providerOnly, setWeeklyAvailability);
router.get('/availability/me', providerOnly, getMyWeeklyAvailability);
// Public: any logged-in user (customer, browsing to book) can check a provider's open slots
router.get('/:providerId/availability/slots', authMiddleware, getAvailableSlots);

router.post('/listings', providerOnly, validate(createListingSchema), createListing);
router.get('/listings/me', providerOnly, getMyListings);
router.patch('/listings/:id', providerOnly, validate(updateListingSchema), updateListing);
router.delete('/listings/:id', providerOnly, deleteListing);

module.exports = router;
