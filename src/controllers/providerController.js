const prisma = require('../config/db');
const { success, error } = require('../utils/responseHandler');

// Create or update the logged-in provider's profile
async function upsertProfile(req, res) {
  const userId = req.user.id;
  const {
    bio,
    experienceYears,
    serviceAreaRadiusKm,
    latitude,
    longitude,
    skills,
    portfolioImages,
  } = req.body;

  const profile = await prisma.providerProfile.upsert({
    where: { userId },
    update: {
      bio,
      experienceYears,
      serviceAreaRadiusKm,
      latitude,
      longitude,
      ...(skills !== undefined && { skills }),
      ...(portfolioImages !== undefined && { portfolioImages }),
    },
    create: {
      userId,
      bio,
      experienceYears,
      serviceAreaRadiusKm,
      latitude,
      longitude,
      skills: skills || [],
      portfolioImages: portfolioImages || [],
    },
  });

  return success(res, profile, 'Provider profile saved');
}

async function getMyProfile(req, res) {
  const profile = await prisma.providerProfile.findUnique({
    where: { userId: req.user.id },
    include: { listings: true, certificates: true, education: true },
  });

  if (!profile) return error(res, 'Provider profile not found', 404);
  return success(res, profile);
}

// Certificates
async function addCertificate(req, res) {
  const { title, issuer, fileUrl, issuedAt } = req.body;

  const profile = await prisma.providerProfile.findUnique({ where: { userId: req.user.id } });
  if (!profile) return error(res, 'Create your provider profile first', 400);

  const certificate = await prisma.certificate.create({
    data: {
      providerId: profile.id,
      title,
      issuer,
      fileUrl,
      issuedAt: issuedAt ? new Date(issuedAt) : null,
    },
  });

  return success(res, certificate, 'সার্টিফিকেট যোগ হয়েছে', 201);
}

async function deleteCertificate(req, res) {
  const { id } = req.params;
  const profile = await prisma.providerProfile.findUnique({ where: { userId: req.user.id } });
  const cert = await prisma.certificate.findUnique({ where: { id } });
  if (!cert || !profile || cert.providerId !== profile.id) {
    return error(res, 'সার্টিফিকেট পাওয়া যায়নি বা আপনার নয়', 403);
  }
  await prisma.certificate.delete({ where: { id } });
  return success(res, {}, 'সার্টিফিকেট মুছে ফেলা হয়েছে');
}

// Education
async function addEducation(req, res) {
  const { institution, degree, yearEnd } = req.body;

  const profile = await prisma.providerProfile.findUnique({ where: { userId: req.user.id } });
  if (!profile) return error(res, 'Create your provider profile first', 400);

  const education = await prisma.education.create({
    data: { providerId: profile.id, institution, degree, yearEnd },
  });

  return success(res, education, 'শিক্ষাগত তথ্য যোগ হয়েছে', 201);
}

async function deleteEducation(req, res) {
  const { id } = req.params;
  const profile = await prisma.providerProfile.findUnique({ where: { userId: req.user.id } });
  const edu = await prisma.education.findUnique({ where: { id } });
  if (!edu || !profile || edu.providerId !== profile.id) {
    return error(res, 'তথ্য পাওয়া যায়নি বা আপনার নয়', 403);
  }
  await prisma.education.delete({ where: { id } });
  return success(res, {}, 'শিক্ষাগত তথ্য মুছে ফেলা হয়েছে');
}

// Create a new service listing (e.g. "AC repair", price, category)
async function createListing(req, res) {
  const {
    categoryId,
    title,
    description,
    price,
    photos,
    pricingType,
    hourlyRate,
    packageTiers,
    isEmergencyAvailable,
    isInstantBookingEnabled,
  } = req.body;

  const profile = await prisma.providerProfile.findUnique({ where: { userId: req.user.id } });
  if (!profile) return error(res, 'Create your provider profile first', 400);

  const listing = await prisma.serviceListing.create({
    data: {
      providerId: profile.id,
      categoryId,
      title,
      description,
      price,
      photos: photos || [],
      pricingType: pricingType || 'FIXED',
      hourlyRate,
      packageTiers,
      isEmergencyAvailable: !!isEmergencyAvailable,
      isInstantBookingEnabled: !!isInstantBookingEnabled,
    },
  });

  return success(res, listing, 'Listing created', 201);
}

async function getMyListings(req, res) {
  const profile = await prisma.providerProfile.findUnique({ where: { userId: req.user.id } });
  if (!profile) return error(res, 'Provider profile not found', 404);

  const listings = await prisma.serviceListing.findMany({ where: { providerId: profile.id } });
  return success(res, listings);
}

async function updateListing(req, res) {
  const { id } = req.params;
  const {
    title,
    description,
    price,
    photos,
    pricingType,
    hourlyRate,
    packageTiers,
    isEmergencyAvailable,
    isInstantBookingEnabled,
  } = req.body;

  const listing = await prisma.serviceListing.findUnique({ where: { id } });
  if (!listing) return error(res, 'Listing not found', 404);

  const profile = await prisma.providerProfile.findUnique({ where: { userId: req.user.id } });
  if (!profile || listing.providerId !== profile.id) {
    return error(res, 'You do not own this listing', 403);
  }

  const updated = await prisma.serviceListing.update({
    where: { id },
    data: {
      title,
      description,
      price,
      photos,
      ...(pricingType !== undefined && { pricingType }),
      ...(hourlyRate !== undefined && { hourlyRate }),
      ...(packageTiers !== undefined && { packageTiers }),
      ...(isEmergencyAvailable !== undefined && { isEmergencyAvailable }),
      ...(isInstantBookingEnabled !== undefined && { isInstantBookingEnabled }),
    },
  });

  return success(res, updated, 'Listing updated');
}

async function deleteListing(req, res) {
  const { id } = req.params;

  const listing = await prisma.serviceListing.findUnique({ where: { id } });
  if (!listing) return error(res, 'Listing not found', 404);

  const profile = await prisma.providerProfile.findUnique({ where: { userId: req.user.id } });
  if (!profile || listing.providerId !== profile.id) {
    return error(res, 'You do not own this listing', 403);
  }

  await prisma.serviceListing.delete({ where: { id } });
  return success(res, {}, 'Listing deleted');
}

module.exports = {
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
};
