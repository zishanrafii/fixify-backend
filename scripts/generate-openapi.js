// Generates docs/api/openapi.json from a structured endpoint list.
// Run: node scripts/generate-openapi.js
'use strict';
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------
// Reusable pieces
// ---------------------------------------------------------------------

const bearerAuth = [{ bearerAuth: [] }];

function ref(name) { return { $ref: `#/components/schemas/${name}` }; }

function envelope(dataSchema, extra = {}) {
  return {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: true },
      message: { type: 'string' },
      data: dataSchema,
      ...extra,
    },
  };
}

function errorResponse(description, example) {
  return {
    description,
    content: { 'application/json': { schema: ref('Error'), ...(example && { example }) } },
  };
}

const commonErrors = {
  400: errorResponse('Bad request / validation error'),
  401: errorResponse('Missing or invalid access token'),
  403: errorResponse('Forbidden — insufficient permission or blocked action'),
  404: errorResponse('Resource not found'),
  409: errorResponse('Conflict — e.g. an invalid state transition'),
  422: errorResponse('Request failed schema validation'),
  429: errorResponse('Rate limit exceeded'),
};

function pick(codes) {
  const out = {};
  for (const c of codes) out[c] = commonErrors[c];
  return out;
}

function jsonBody(schema) {
  return { required: true, content: { 'application/json': { schema } } };
}

function successResponse(description, dataSchema, statusCode = '200') {
  return { [statusCode]: { description, content: { 'application/json': { schema: envelope(dataSchema) } } } };
}

function pathParam(name, description, schema = { type: 'string' }) {
  return { name, in: 'path', required: true, description, schema };
}

function queryParam(name, description, schema = { type: 'string' }, required = false) {
  return { name, in: 'query', required, description, schema };
}

const paginationParams = [
  queryParam('page', 'পেজ নম্বর, 1-indexed', { type: 'integer', default: 1 }),
  queryParam('limit', 'প্রতি পেজে কতগুলো (max ভিন্ন endpoint-এ ভিন্ন, সাধারণত 50-100)', { type: 'integer', default: 20 }),
];

function paginationSchema(itemRef) {
  return {
    type: 'object',
    properties: {
      [itemRef.arrayKey || 'items']: { type: 'array', items: ref(itemRef.name) },
      pagination: ref('Pagination'),
    },
  };
}

// ---------------------------------------------------------------------
// Component schemas
// ---------------------------------------------------------------------

const schemas = {
  Error: {
    type: 'object',
    properties: { success: { type: 'boolean', example: false }, message: { type: 'string' } },
  },
  Pagination: {
    type: 'object',
    properties: {
      page: { type: 'integer' }, limit: { type: 'integer' },
      total: { type: 'integer' }, totalPages: { type: 'integer' },
    },
  },
  AuthTokens: {
    type: 'object',
    properties: {
      accessToken: { type: 'string', description: 'JWT, 15 মিনিট মেয়াদ' },
      refreshToken: { type: 'string', description: 'Opaque token, 30 দিন মেয়াদ, single-use (rotates)' },
    },
  },
  User: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      phone: { type: 'string', nullable: true, example: '01712345678' },
      email: { type: 'string', nullable: true, format: 'email' },
      name: { type: 'string' },
      role: { type: 'string', enum: ['CUSTOMER', 'PROVIDER', 'ADMIN'] },
      isVerified: { type: 'boolean' },
      isGuest: { type: 'boolean' },
      isSuspended: { type: 'boolean' },
      avatarUrl: { type: 'string', nullable: true },
      referralCode: { type: 'string', nullable: true },
      lastSeenAt: { type: 'string', format: 'date-time', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  Address: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' }, label: { type: 'string', nullable: true },
      addressLine: { type: 'string' }, latitude: { type: 'number' }, longitude: { type: 'number' },
      city: { type: 'string', nullable: true }, district: { type: 'string', nullable: true },
      division: { type: 'string', nullable: true }, country: { type: 'string', nullable: true },
      isDefault: { type: 'boolean' },
    },
  },
  ProviderProfile: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' }, userId: { type: 'string', format: 'uuid' },
      bio: { type: 'string', nullable: true }, experienceYears: { type: 'integer', nullable: true },
      status: { type: 'string', enum: ['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'INACTIVE'] },
      isOnline: { type: 'boolean' }, avgRating: { type: 'number' }, totalReviews: { type: 'integer' },
    },
  },
  ServiceListing: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' }, title: { type: 'string' }, description: { type: 'string', nullable: true },
      price: { type: 'number' }, pricingType: { type: 'string', enum: ['FIXED', 'HOURLY', 'PACKAGE', 'SUBSCRIPTION'] },
      photos: { type: 'array', items: { type: 'string' } },
    },
  },
  Booking: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      customerId: { type: 'string', format: 'uuid' }, providerId: { type: 'string', format: 'uuid' },
      listingId: { type: 'string', format: 'uuid' },
      status: {
        type: 'string',
        enum: ['PENDING', 'ACCEPTED', 'REJECTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_PROVIDER', 'EXPIRED', 'DISPUTED'],
      },
      bookingType: { type: 'string', enum: ['SCHEDULED', 'INSTANT', 'EMERGENCY'] },
      scheduledTime: { type: 'string', format: 'date-time' },
      serviceAddress: { type: 'string' }, latitude: { type: 'number' }, longitude: { type: 'number' },
      agreedPrice: { type: 'number' },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  WalletAccount: {
    type: 'object',
    properties: { balance: { type: 'number' } },
  },
  LedgerTransaction: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      amount: { type: 'number' },
      reason: {
        type: 'string',
        enum: ['PAYMENT_CAPTURED', 'ESCROW_RELEASE', 'PLATFORM_COMMISSION', 'REFUND', 'WITHDRAWAL_REQUEST', 'WITHDRAWAL_COMPLETED', 'WITHDRAWAL_REJECTED', 'REFERRAL_BONUS', 'CASHBACK', 'PROMO_CREDIT', 'ADMIN_ADJUSTMENT'],
      },
      direction: { type: 'string', enum: ['credit', 'debit'], description: 'এই account-এর সাপেক্ষে' },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  WithdrawalRequest: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' }, amount: { type: 'number' }, method: { type: 'string' },
      status: { type: 'string', enum: ['PENDING', 'COMPLETED', 'REJECTED'] },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  Payment: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' }, bookingId: { type: 'string', format: 'uuid' },
      amount: { type: 'number' }, provider: { type: 'string', enum: ['SSLCOMMERZ', 'STRIPE'] },
      status: { type: 'string', enum: ['pending', 'success', 'failed', 'escrow_held', 'refunded'] },
    },
  },
  Notification: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' }, title: { type: 'string' }, body: { type: 'string' },
      category: { type: 'string', enum: ['BOOKING', 'PAYMENT', 'WALLET', 'VERIFICATION', 'SECURITY', 'SYSTEM'] },
      isRead: { type: 'boolean' }, createdAt: { type: 'string', format: 'date-time' },
    },
  },
  Conversation: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      type: { type: 'string', enum: ['CUSTOMER_PROVIDER', 'CUSTOMER_SUPPORT', 'ADMIN_CUSTOMER', 'ADMIN_PROVIDER'] },
      status: { type: 'string', enum: ['ACTIVE', 'LOCKED', 'ARCHIVED'] },
      lastMessageAt: { type: 'string', format: 'date-time', nullable: true },
    },
  },
  Message: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' }, conversationId: { type: 'string', format: 'uuid' },
      senderId: { type: 'string', format: 'uuid' },
      type: { type: 'string', enum: ['TEXT', 'IMAGE', 'DOCUMENT', 'VOICE', 'LOCATION'] },
      text: { type: 'string', nullable: true },
      status: { type: 'string', enum: ['SENT', 'DELIVERED', 'READ', 'PENDING_REVIEW', 'BLOCKED'] },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  Dispute: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' }, bookingId: { type: 'string', format: 'uuid' },
      reason: { type: 'string' }, status: { type: 'string', enum: ['OPEN', 'RESOLVED', 'REJECTED'] },
    },
  },
};

// ---------------------------------------------------------------------
// Path/endpoint definitions
// ---------------------------------------------------------------------

const endpoints = [];
function add(e) { endpoints.push(e); }

// ===== Authentication =====
add({ method: 'post', path: '/api/auth/send-otp', tag: 'Authentication', summary: 'ফোন OTP পাঠানো',
  description: 'SMS-এ ৬-ডিজিটের OTP পাঠায়, ৫ মিনিট মেয়াদ। Rate limited: ৩ রিকোয়েস্ট / ১৫ মিনিট / IP।',
  rateLimit: '3 req / 15 min / IP',
  requestBody: jsonBody({ type: 'object', required: ['phone'], properties: { phone: { type: 'string', example: '01712345678' } } }),
  responses: { ...successResponse('OTP পাঠানো হয়েছে', { type: 'object' }), ...pick([422, 429]) } });

add({ method: 'post', path: '/api/auth/signup', tag: 'Authentication', summary: 'ফোন+OTP দিয়ে সাইনআপ সম্পন্ন করা',
  description: 'OTP verify করে নতুন account তৈরি করে; success হলে accessToken+refreshToken রিটার্ন করে।',
  rateLimit: '8 req / 15 min / IP',
  requestBody: jsonBody({ type: 'object', required: ['phone', 'otp', 'name', 'password'], properties: {
    phone: { type: 'string' }, otp: { type: 'string', minLength: 6, maxLength: 6 }, name: { type: 'string', minLength: 2 },
    password: { type: 'string', minLength: 8 }, role: { type: 'string', enum: ['CUSTOMER', 'PROVIDER'] }, referralCode: { type: 'string', nullable: true } } }),
  responses: { ...successResponse('অ্যাকাউন্ট তৈরি হয়েছে', { allOf: [ref('AuthTokens'), { type: 'object', properties: { user: ref('User') } }] }, '201'), ...pick([400, 422, 429]) } });

add({ method: 'post', path: '/api/auth/login', tag: 'Authentication', summary: 'ফোন+পাসওয়ার্ড লগইন',
  description: 'সঠিক credential দিলে accessToken+refreshToken রিটার্ন করে।', rateLimit: '8 req / 15 min / IP',
  requestBody: jsonBody({ type: 'object', required: ['phone', 'password'], properties: { phone: { type: 'string' }, password: { type: 'string' } } }),
  responses: { ...successResponse('লগইন সফল', { allOf: [ref('AuthTokens'), { type: 'object', properties: { user: ref('User') } }] }), ...pick([401, 403, 422, 429]) } });

add({ method: 'post', path: '/api/auth/email-login', tag: 'Authentication', summary: 'ইমেইল+পাসওয়ার্ড লগইন',
  description: 'phone login-এর বিকল্প।', rateLimit: '8 req / 15 min / IP',
  requestBody: jsonBody({ type: 'object', required: ['email', 'password'], properties: { email: { type: 'string', format: 'email' }, password: { type: 'string' } } }),
  responses: { ...successResponse('লগইন সফল', { allOf: [ref('AuthTokens'), { type: 'object', properties: { user: ref('User') } }] }), ...pick([401, 403, 422, 429]) } });

add({ method: 'post', path: '/api/auth/social-login', tag: 'Authentication', summary: 'Google/Apple/Facebook দিয়ে লগইন/সাইনআপ',
  description: 'ক্লায়েন্ট শুধু raw provider token পাঠায় — কখনো client-supplied profile trust করা হয় না, server-side verify হয়।',
  rateLimit: '8 req / 15 min / IP',
  requestBody: jsonBody({ type: 'object', required: ['provider', 'token'], properties: {
    provider: { type: 'string', enum: ['GOOGLE', 'APPLE', 'FACEBOOK'] }, token: { type: 'string', minLength: 10 },
    fullName: { type: 'string', description: 'শুধু Apple প্রথম sign-in-এ, unverified' } } }),
  responses: { ...successResponse('লগইন সফল', { allOf: [ref('AuthTokens'), { type: 'object', properties: { user: ref('User') } }] }), ...pick([401, 403, 422, 429, 500]) } });

add({ method: 'post', path: '/api/auth/guest-login', tag: 'Authentication', summary: 'Guest session শুরু',
  description: 'Guest browse/search করতে পারে, booking/chat/profile-edit করতে পারে না।',
  responses: successResponse('Guest session শুরু হয়েছে', { allOf: [ref('AuthTokens'), { type: 'object', properties: { user: ref('User') } }] }) });

add({ method: 'post', path: '/api/auth/refresh-token', tag: 'Authentication', summary: 'Access token রিফ্রেশ',
  description: 'Single-use, rotating। একই token দ্বিতীয়বার ব্যবহারের চেষ্টা হলে ইউজারের সব session revoke হয়ে যায়।',
  requestBody: jsonBody({ type: 'object', required: ['refreshToken'], properties: { refreshToken: { type: 'string' } } }),
  responses: { ...successResponse('নতুন token pair', ref('AuthTokens')), ...pick([400, 401, 403]) } });

add({ method: 'post', path: '/api/auth/logout', tag: 'Authentication', summary: 'Refresh token revoke করা',
  description: 'Idempotent — invalid/missing token দিয়েও 200 রিটার্ন করে।',
  requestBody: { required: false, content: { 'application/json': { schema: { type: 'object', properties: { refreshToken: { type: 'string' } } } } } },
  responses: successResponse('লগআউট সফল', { type: 'object' }) });

add({ method: 'get', path: '/api/auth/me', tag: 'Authentication', summary: 'বর্তমান লগইন করা ইউজার',
  description: 'DB থেকে fresh user data রিটার্ন করে।', security: bearerAuth,
  responses: { ...successResponse('বর্তমান ইউজার', { type: 'object', properties: { user: ref('User') } }), ...pick([401, 404]) } });

// ===== User =====
add({ method: 'get', path: '/api/users/referral-stats', tag: 'User', summary: 'রেফারেল পরিসংখ্যান', security: bearerAuth,
  responses: { ...successResponse('রেফারেল স্ট্যাটস', { type: 'object' }), ...pick([401, 404]) } });

add({ method: 'patch', path: '/api/users/profile', tag: 'User', summary: 'প্রোফাইল আপডেট', security: bearerAuth,
  description: 'Guest account এই endpoint ব্যবহার করতে পারবে না (403)।',
  requestBody: jsonBody({ type: 'object', properties: {
    name: { type: 'string', minLength: 2, maxLength: 100 }, avatarUrl: { type: 'string', format: 'uri' },
    address: { type: 'string' }, latitude: { type: 'number', minimum: -90, maximum: 90 }, longitude: { type: 'number', minimum: -180, maximum: 180 },
    languages: { type: 'array', items: { type: 'string' } } } }),
  responses: { ...successResponse('প্রোফাইল আপডেট হয়েছে', ref('User')), ...pick([401, 403, 422]) } });

add({ method: 'post', path: '/api/users/verification/id', tag: 'User', summary: 'ID ভেরিফিকেশনের জন্য জমা দেওয়া', security: bearerAuth,
  requestBody: jsonBody({ type: 'object', required: ['idDocumentUrl'], properties: { idDocumentUrl: { type: 'string', format: 'uri' } } }),
  responses: { ...successResponse('জমা হয়েছে, রিভিউ চলছে', ref('User')), ...pick([401, 403, 422]) } });

add({ method: 'post', path: '/api/users/verification/face', tag: 'User', summary: 'Face ভেরিফিকেশনের জন্য জমা দেওয়া', security: bearerAuth,
  requestBody: jsonBody({ type: 'object', required: ['selfieUrl'], properties: { selfieUrl: { type: 'string', format: 'uri' } } }),
  responses: { ...successResponse('জমা হয়েছে, রিভিউ চলছে', ref('User')), ...pick([401, 403, 422]) } });

// ===== Address =====
add({ method: 'post', path: '/api/addresses', tag: 'Address', summary: 'নতুন ঠিকানা যোগ করা', security: bearerAuth,
  requestBody: jsonBody({ type: 'object', required: ['addressLine', 'latitude', 'longitude'], properties: {
    label: { type: 'string', maxLength: 50 }, addressLine: { type: 'string', minLength: 3 },
    latitude: { type: 'number', minimum: -90, maximum: 90 }, longitude: { type: 'number', minimum: -180, maximum: 180 }, isDefault: { type: 'boolean' } } }),
  responses: { ...successResponse('ঠিকানা যোগ হয়েছে', ref('Address'), '201'), ...pick([401, 403, 422]) } });

add({ method: 'get', path: '/api/addresses/me', tag: 'Address', summary: 'আমার সব ঠিকানা', security: bearerAuth,
  responses: { ...successResponse('ঠিকানার তালিকা', { type: 'array', items: ref('Address') }), ...pick([401]) } });

add({ method: 'delete', path: '/api/addresses/{id}', tag: 'Address', summary: 'ঠিকানা মুছে ফেলা (soft delete)', security: bearerAuth,
  params: [pathParam('id', 'Address ID')],
  responses: { ...successResponse('মুছে ফেলা হয়েছে', { type: 'object' }), ...pick([401, 403, 404]) } });

// ===== Provider =====
add({ method: 'post', path: '/api/providers/profile', tag: 'Provider', summary: 'প্রোভাইডার প্রোফাইল create/update', security: bearerAuth,
  description: 'শুধু role=PROVIDER, non-guest। নতুন profile তৈরি হলে status=PENDING_VERIFICATION।',
  requestBody: jsonBody({ type: 'object', properties: {
    bio: { type: 'string', maxLength: 2000 }, experienceYears: { type: 'integer', minimum: 0, maximum: 80 },
    serviceAreaRadiusKm: { type: 'number' }, latitude: { type: 'number' }, longitude: { type: 'number' },
    skills: { type: 'array', items: { type: 'string' } }, portfolioImages: { type: 'array', items: { type: 'string', format: 'uri' } } } }),
  responses: { ...successResponse('প্রোফাইল সেভ হয়েছে', ref('ProviderProfile')), ...pick([401, 403, 422]) } });

add({ method: 'get', path: '/api/providers/profile/me', tag: 'Provider', summary: 'আমার প্রোভাইডার প্রোফাইল', security: bearerAuth,
  responses: { ...successResponse('প্রোফাইল', ref('ProviderProfile')), ...pick([401, 403, 404]) } });

add({ method: 'post', path: '/api/providers/certificates', tag: 'Provider', summary: 'সার্টিফিকেট যোগ করা', security: bearerAuth,
  requestBody: jsonBody({ type: 'object', required: ['title'], properties: { title: { type: 'string' }, issuer: { type: 'string' }, fileUrl: { type: 'string', format: 'uri' }, issuedAt: { type: 'string' } } }),
  responses: { ...successResponse('যোগ হয়েছে', { type: 'object' }, '201'), ...pick([401, 403, 422]) } });

add({ method: 'delete', path: '/api/providers/certificates/{id}', tag: 'Provider', summary: 'সার্টিফিকেট মুছে ফেলা', security: bearerAuth,
  params: [pathParam('id', 'Certificate ID')], responses: { ...successResponse('মুছে ফেলা হয়েছে', { type: 'object' }), ...pick([401, 403, 404]) } });

add({ method: 'post', path: '/api/providers/education', tag: 'Provider', summary: 'শিক্ষাগত যোগ্যতা যোগ করা', security: bearerAuth,
  requestBody: jsonBody({ type: 'object', required: ['institution'], properties: { institution: { type: 'string' }, degree: { type: 'string' }, yearEnd: { type: 'integer' } } }),
  responses: { ...successResponse('যোগ হয়েছে', { type: 'object' }, '201'), ...pick([401, 403, 422]) } });

add({ method: 'delete', path: '/api/providers/education/{id}', tag: 'Provider', summary: 'শিক্ষাগত যোগ্যতা মুছে ফেলা', security: bearerAuth,
  params: [pathParam('id', 'Education record ID')], responses: { ...successResponse('মুছে ফেলা হয়েছে', { type: 'object' }), ...pick([401, 403, 404]) } });

add({ method: 'put', path: '/api/providers/availability', tag: 'Provider', summary: 'সাপ্তাহিক সময়সূচি সেট করা', security: bearerAuth,
  responses: { ...successResponse('সেভ হয়েছে', { type: 'object' }), ...pick([401, 403, 422]) } });

add({ method: 'get', path: '/api/providers/availability/me', tag: 'Provider', summary: 'আমার সাপ্তাহিক সময়সূচি', security: bearerAuth,
  responses: { ...successResponse('সময়সূচি', { type: 'object' }), ...pick([401, 403]) } });

add({ method: 'get', path: '/api/providers/{providerId}/availability/slots', tag: 'Provider', summary: 'একজন প্রোভাইডারের খালি সময় দেখা', security: bearerAuth,
  params: [pathParam('providerId', 'ProviderProfile ID')], responses: { ...successResponse('খালি স্লট', { type: 'array', items: { type: 'object' } }), ...pick([401, 404]) } });

add({ method: 'post', path: '/api/providers/listings', tag: 'Provider', summary: 'সার্ভিস লিস্টিং তৈরি', security: bearerAuth,
  requestBody: jsonBody({ type: 'object', required: ['categoryId', 'title', 'price'], properties: {
    categoryId: { type: 'string' }, title: { type: 'string', maxLength: 200 }, description: { type: 'string' }, price: { type: 'number', exclusiveMinimum: 0 },
    photos: { type: 'array', items: { type: 'string', format: 'uri' } }, pricingType: { type: 'string', enum: ['FIXED', 'HOURLY', 'PACKAGE', 'SUBSCRIPTION'] } } }),
  responses: { ...successResponse('লিস্টিং তৈরি হয়েছে', ref('ServiceListing'), '201'), ...pick([400, 401, 403, 422]) } });

add({ method: 'get', path: '/api/providers/listings/me', tag: 'Provider', summary: 'আমার সব লিস্টিং', security: bearerAuth,
  responses: { ...successResponse('লিস্টিং তালিকা', { type: 'array', items: ref('ServiceListing') }), ...pick([401, 403]) } });

add({ method: 'patch', path: '/api/providers/listings/{id}', tag: 'Provider', summary: 'লিস্টিং আপডেট', security: bearerAuth,
  params: [pathParam('id', 'Listing ID')], responses: { ...successResponse('আপডেট হয়েছে', ref('ServiceListing')), ...pick([401, 403, 404, 422]) } });

add({ method: 'delete', path: '/api/providers/listings/{id}', tag: 'Provider', summary: 'লিস্টিং মুছে ফেলা (soft delete)', security: bearerAuth,
  params: [pathParam('id', 'Listing ID')], responses: { ...successResponse('মুছে ফেলা হয়েছে', { type: 'object' }), ...pick([401, 403, 404]) } });

// ===== Booking =====
add({ method: 'post', path: '/api/bookings', tag: 'Booking', summary: 'নতুন বুকিং তৈরি', security: bearerAuth,
  description: 'শুধু non-guest customer। Provider status=ACTIVE না হলে reject। Address+price snapshot করে রাখে।',
  requestBody: jsonBody({ type: 'object', required: ['listingId', 'addressId', 'scheduledTime'], properties: {
    listingId: { type: 'string' }, addressId: { type: 'string' }, scheduledTime: { type: 'string', format: 'date-time' },
    bookingType: { type: 'string', enum: ['SCHEDULED', 'INSTANT', 'EMERGENCY'] }, isRecurring: { type: 'boolean' },
    recurrenceRule: { type: 'string', enum: ['DAILY', 'WEEKLY', 'MONTHLY'] } } }),
  responses: { ...successResponse('বুকিং অনুরোধ পাঠানো হয়েছে', ref('Booking'), '201'), ...pick([400, 401, 403, 404, 422]) } });

add({ method: 'get', path: '/api/bookings/me', tag: 'Booking', summary: 'আমার বুকিং তালিকা (paginated)', security: bearerAuth,
  params: [...paginationParams, queryParam('status', 'status দিয়ে filter')],
  responses: { ...successResponse('বুকিং তালিকা', paginationSchema({ name: 'Booking', arrayKey: 'bookings' })), ...pick([401]) } });

add({ method: 'get', path: '/api/bookings/{id}', tag: 'Booking', summary: 'একক বুকিং বিস্তারিত', security: bearerAuth,
  params: [pathParam('id', 'Booking ID')], responses: { ...successResponse('বুকিং বিস্তারিত', ref('Booking')), ...pick([401, 403, 404]) } });

for (const [action, summary, desc] of [
  ['accept', 'বুকিং গ্রহণ (provider)', 'PENDING → ACCEPTED। শুধু provider।'],
  ['reject', 'বুকিং প্রত্যাখ্যান (provider)', 'PENDING → REJECTED + escrow refund। শুধু provider।'],
  ['start', 'কাজ শুরু (provider)', 'ACCEPTED → IN_PROGRESS। শুধু provider।'],
  ['provider-done', 'কাজ শেষ চিহ্নিত (provider)', 'কাজ শেষ, গ্রাহকের কনফার্মেশনের অপেক্ষায় — status বদলায় না এখনই।'],
  ['confirm-complete', 'কাজ সম্পন্ন কনফার্ম (customer)', 'IN_PROGRESS → COMPLETED + escrow release। শুধু customer, শুধু provider আগে "done" মার্ক করলে।'],
]) {
  add({ method: 'patch', path: `/api/bookings/{id}/${action}`, tag: 'Booking', summary, description: desc, security: bearerAuth,
    params: [pathParam('id', 'Booking ID')], responses: { ...successResponse(summary, { type: 'object' }), ...pick([401, 403, 404, 409]) } });
}

add({ method: 'patch', path: '/api/bookings/{id}/cancel', tag: 'Booking', summary: 'বুকিং বাতিল', security: bearerAuth,
  description: 'PENDING/ACCEPTED অবস্থা থেকেই সম্ভব — IN_PROGRESS-এ ডিসপিউট প্রয়োজন। Escrow refund হয়।',
  params: [pathParam('id', 'Booking ID')],
  requestBody: jsonBody({ type: 'object', required: ['reason'], properties: { reason: { type: 'string', minLength: 3, maxLength: 500 } } }),
  responses: { ...successResponse('বাতিল হয়েছে', { type: 'object' }), ...pick([401, 403, 404, 409, 422]) } });

add({ method: 'patch', path: '/api/bookings/{id}/reschedule', tag: 'Booking', summary: 'বুকিং রিশিডিউল', security: bearerAuth,
  params: [pathParam('id', 'Booking ID')],
  requestBody: jsonBody({ type: 'object', required: ['scheduledTime'], properties: { scheduledTime: { type: 'string', format: 'date-time' } } }),
  responses: { ...successResponse('রিশিডিউল হয়েছে', { type: 'object' }), ...pick([401, 403, 404, 409, 422]) } });

// ===== Wallet =====
add({ method: 'get', path: '/api/wallet/me', tag: 'Wallet', summary: 'আমার ওয়ালেট ব্যালেন্স + ইতিহাস (paginated)', security: bearerAuth,
  params: paginationParams,
  responses: { ...successResponse('ওয়ালেট', { allOf: [ref('WalletAccount'), { type: 'object', properties: { transactions: { type: 'array', items: ref('LedgerTransaction') }, pagination: ref('Pagination') } }] }), ...pick([401]) } });

add({ method: 'post', path: '/api/wallet/withdraw', tag: 'Wallet', summary: 'উত্তোলনের অনুরোধ', security: bearerAuth,
  description: 'টাকা সাথে সাথে wallet থেকে সরে "pending payout" account-এ রিজার্ভ হয় — double-withdraw structurally impossible।',
  requestBody: jsonBody({ type: 'object', required: ['amount', 'method', 'accountDetails'], properties: {
    amount: { type: 'number', exclusiveMinimum: 0 }, method: { type: 'string' }, accountDetails: { type: 'string' }, idempotencyKey: { type: 'string' } } }),
  responses: { ...successResponse('অনুরোধ জমা হয়েছে', ref('WithdrawalRequest'), '201'), ...pick([401, 403, 422]) } });

add({ method: 'get', path: '/api/wallet/withdrawals/me', tag: 'Wallet', summary: 'আমার উত্তোলনের ইতিহাস', security: bearerAuth,
  responses: { ...successResponse('উত্তোলনের তালিকা', { type: 'array', items: ref('WithdrawalRequest') }), ...pick([401]) } });

// ===== Payment =====
add({ method: 'post', path: '/api/payments/start', tag: 'Payment', summary: 'SSLCommerz পেমেন্ট শুরু', security: bearerAuth,
  description: 'শুধু বুকিং-এর customer। কুপন প্রযোজ্য। Idempotent claim।',
  requestBody: jsonBody({ type: 'object', required: ['bookingId'], properties: { bookingId: { type: 'string' }, couponCode: { type: 'string' } } }),
  responses: { ...successResponse('গেটওয়ে URL', { type: 'object', properties: { gatewayPageUrl: { type: 'string' }, amount: { type: 'number' } } }), ...pick([400, 401, 403, 404, 500]) } });

add({ method: 'post', path: '/api/payments/stripe/intent', tag: 'Payment', summary: 'Stripe payment intent তৈরি', security: bearerAuth,
  requestBody: jsonBody({ type: 'object', required: ['bookingId'], properties: { bookingId: { type: 'string' }, couponCode: { type: 'string' }, currency: { type: 'string' } } }),
  responses: { ...successResponse('client secret', { type: 'object', properties: { clientSecret: { type: 'string' } } }), ...pick([400, 401, 403, 404, 500]) } });

add({ method: 'post', path: '/api/payments/callback/{status}', tag: 'Payment', summary: 'SSLCommerz callback (server-to-server)',
  description: 'SSLCommerz সরাসরি কল করে (JWT auth নেই)। val_id দিয়ে server-side Validation API-তে verify করা হয়।',
  params: [pathParam('status', 'success | fail | cancel', { type: 'string', enum: ['success', 'fail', 'cancel'] })],
  responses: { ...successResponse('প্রসেস হয়েছে', { type: 'object' }), ...pick([400, 404]) } });

add({ method: 'post', path: '/api/payments/stripe/webhook', tag: 'Payment', summary: 'Stripe webhook',
  description: '`stripe-signature` হেডার দিয়ে verify হয় (raw body প্রয়োজন)। STRIPE_WEBHOOK_SECRET না থাকলে fail-closed।',
  responses: { ...successResponse('গ্রহণ করা হয়েছে', { type: 'object' }), 400: errorResponse('অবৈধ signature') } });

// ===== Notification =====
add({ method: 'post', path: '/api/notifications/register-token', tag: 'Notification', summary: 'FCM device token রেজিস্টার', security: bearerAuth,
  requestBody: jsonBody({ type: 'object', required: ['fcmToken'], properties: { fcmToken: { type: 'string' } } }),
  responses: { ...successResponse('রেজিস্টার হয়েছে', { type: 'object' }), ...pick([401, 422]) } });

add({ method: 'get', path: '/api/notifications/me', tag: 'Notification', summary: 'আমার নোটিফিকেশন তালিকা (paginated)', security: bearerAuth,
  params: [...paginationParams, queryParam('category', ''), queryParam('isRead', '', { type: 'boolean' })],
  responses: { ...successResponse('নোটিফিকেশন তালিকা', { type: 'object', properties: { notifications: { type: 'array', items: ref('Notification') }, unreadCount: { type: 'integer' }, pagination: ref('Pagination') } }), ...pick([401]) } });

add({ method: 'patch', path: '/api/notifications/{id}/read', tag: 'Notification', summary: 'একটা নোটিফিকেশন পড়া হিসেবে চিহ্নিত', security: bearerAuth,
  params: [pathParam('id', 'Notification ID')], responses: { ...successResponse('পড়া হয়েছে', { type: 'object' }), ...pick([401, 404]) } });

add({ method: 'patch', path: '/api/notifications/read-all', tag: 'Notification', summary: 'সব পড়া হিসেবে চিহ্নিত', security: bearerAuth,
  responses: { ...successResponse('সব পড়া হয়েছে', { type: 'object' }), ...pick([401]) } });

add({ method: 'get', path: '/api/notifications/preferences', tag: 'Notification', summary: 'নোটিফিকেশন প্রেফারেন্স দেখা', security: bearerAuth,
  responses: { ...successResponse('প্রেফারেন্স', { type: 'array', items: { type: 'object' } }), ...pick([401]) } });

add({ method: 'put', path: '/api/notifications/preferences', tag: 'Notification', summary: 'নোটিফিকেশন প্রেফারেন্স আপডেট', security: bearerAuth,
  description: 'SECURITY category-তে PUSH ও EMAIL দুটোই বন্ধ করা যাবে না।',
  requestBody: jsonBody({ type: 'object', required: ['category'], properties: {
    category: { type: 'string', enum: ['BOOKING', 'PAYMENT', 'WALLET', 'VERIFICATION', 'SECURITY', 'SYSTEM'] },
    pushEnabled: { type: 'boolean' }, emailEnabled: { type: 'boolean' }, smsEnabled: { type: 'boolean' }, inAppEnabled: { type: 'boolean' } } }),
  responses: { ...successResponse('আপডেট হয়েছে', { type: 'object' }), ...pick([401, 422]) } });

// ===== Chat =====
add({ method: 'get', path: '/api/chat/bookings/{bookingId}/conversation', tag: 'Chat', summary: 'বুকিং থেকে conversation resolve/lazily-create', security: bearerAuth,
  description: 'Booking status ACCEPTED-এর আগে চ্যাট শুরু করা যাবে না।',
  params: [pathParam('bookingId', 'Booking ID')], responses: { ...successResponse('Conversation', ref('Conversation')), ...pick([400, 401, 403, 404]) } });

add({ method: 'post', path: '/api/chat/conversations/support', tag: 'Chat', summary: 'Customer↔Support conversation শুরু', security: bearerAuth,
  responses: { ...successResponse('Conversation', ref('Conversation'), '201'), ...pick([401, 403]) } });

add({ method: 'get', path: '/api/chat/conversations', tag: 'Chat', summary: 'আমার সব conversation', security: bearerAuth,
  responses: { ...successResponse('Conversation তালিকা', { type: 'array', items: ref('Conversation') }), ...pick([401]) } });

add({ method: 'get', path: '/api/chat/conversations/{id}/messages', tag: 'Chat', summary: 'মেসেজ ইতিহাস (cursor-paginated)', security: bearerAuth,
  params: [pathParam('id', 'Conversation ID'), queryParam('cursor', 'শেষ message-এর id'), queryParam('limit', '', { type: 'integer', default: 30 })],
  responses: { ...successResponse('মেসেজ', { type: 'object', properties: { messages: { type: 'array', items: ref('Message') }, nextCursor: { type: 'string', nullable: true } } }), ...pick([401, 403]) } });

add({ method: 'post', path: '/api/chat/conversations/{id}/messages', tag: 'Chat', summary: 'মেসেজ পাঠানো (REST fallback)', security: bearerAuth,
  description: 'সাধারণত WebSocket `send_message` event ব্যবহার হয় — এটা fallback। Communication Policy Engine অনুযায়ী WARN/REVIEW/BLOCK হতে পারে।',
  params: [pathParam('id', 'Conversation ID')],
  requestBody: jsonBody({ type: 'object', required: ['type'], properties: { type: { type: 'string', enum: ['TEXT', 'IMAGE', 'DOCUMENT', 'VOICE', 'LOCATION'] }, text: { type: 'string' }, attachment: { type: 'object' } } }),
  responses: { ...successResponse('পাঠানো হয়েছে', ref('Message'), '201'), 422: errorResponse('Policy দ্বারা BLOCK হয়েছে'), ...pick([400, 401, 403, 429]) } });

add({ method: 'patch', path: '/api/chat/conversations/{id}/read', tag: 'Chat', summary: 'সব মেসেজ পড়া হিসেবে চিহ্নিত (bulk)', security: bearerAuth,
  params: [pathParam('id', 'Conversation ID')], responses: { ...successResponse('পড়া হয়েছে', { type: 'object' }), ...pick([401, 403]) } });

add({ method: 'post', path: '/api/chat/messages/{id}/report', tag: 'Chat', summary: 'মেসেজ রিপোর্ট করা', security: bearerAuth,
  params: [pathParam('id', 'Message ID')],
  requestBody: jsonBody({ type: 'object', required: ['reason'], properties: { reason: { type: 'string' } } }),
  responses: { ...successResponse('রিপোর্ট জমা হয়েছে', { type: 'object' }, '201'), ...pick([401, 403, 404]) } });

// ===== Search (public) =====
add({ method: 'get', path: '/api/search', tag: 'Search', summary: 'প্রোভাইডার/লিস্টিং খোঁজা (পাবলিক)',
  params: [queryParam('q', 'খোঁজার শব্দ'), queryParam('categoryId', ''), queryParam('lat', '', { type: 'number' }), queryParam('lng', '', { type: 'number' })],
  responses: successResponse('ফলাফল', { type: 'array', items: ref('ServiceListing') }) });

add({ method: 'get', path: '/api/search/listings/{id}', tag: 'Search', summary: 'একক লিস্টিং বিস্তারিত (পাবলিক)',
  params: [pathParam('id', 'Listing ID')], responses: { ...successResponse('লিস্টিং', ref('ServiceListing')), ...pick([404]) } });

add({ method: 'get', path: '/api/search/categories', tag: 'Search', summary: 'সব ক্যাটাগরি (পাবলিক)',
  responses: successResponse('ক্যাটাগরি তালিকা', { type: 'array', items: { type: 'object' } }) });

add({ method: 'post', path: '/api/search/categories', tag: 'Search', summary: '⚠️ নতুন ক্যাটাগরি তৈরি (admin) — দেখুন Inconsistency Report', security: bearerAuth, permission: 'categories.manage',
  description: 'এই admin-only write endpoint টা `/api/search`-এর নিচে আছে, `/api/admin`-এর নিচে না — placement inconsistency, Inconsistency Report দেখুন।',
  requestBody: jsonBody({ type: 'object', required: ['name'], properties: { name: { type: 'string' } } }),
  responses: { ...successResponse('তৈরি হয়েছে', { type: 'object' }, '201'), ...pick([401, 403, 422]) } });

add({ method: 'patch', path: '/api/search/categories/{id}', tag: 'Search', summary: 'ক্যাটাগরি আপডেট (admin)', security: bearerAuth, permission: 'categories.manage',
  params: [pathParam('id', 'Category ID')], responses: { ...successResponse('আপডেট হয়েছে', { type: 'object' }), ...pick([401, 403, 404]) } });

add({ method: 'delete', path: '/api/search/categories/{id}', tag: 'Search', summary: 'ক্যাটাগরি মুছে ফেলা (admin)', security: bearerAuth, permission: 'categories.manage',
  params: [pathParam('id', 'Category ID')], responses: { ...successResponse('মুছে ফেলা হয়েছে', { type: 'object' }), ...pick([401, 403, 404]) } });

// ===== Dispute =====
add({ method: 'post', path: '/api/disputes', tag: 'Dispute', summary: 'অভিযোগ জমা দেওয়া', security: bearerAuth,
  description: 'শুধু IN_PROGRESS/COMPLETED বুকিং-এর জন্য।',
  requestBody: jsonBody({ type: 'object', required: ['bookingId', 'reason'], properties: { bookingId: { type: 'string' }, reason: { type: 'string' }, description: { type: 'string' } } }),
  responses: { ...successResponse('জমা হয়েছে', ref('Dispute'), '201'), ...pick([400, 401, 403, 404]) } });

add({ method: 'get', path: '/api/disputes/mine', tag: 'Dispute', summary: 'আমার অভিযোগের তালিকা', security: bearerAuth,
  responses: { ...successResponse('তালিকা', { type: 'array', items: ref('Dispute') }), ...pick([401]) } });

add({ method: 'get', path: '/api/disputes/open', tag: 'Dispute', summary: 'খোলা অভিযোগ তালিকা (admin)', security: bearerAuth, permission: 'disputes.view',
  responses: { ...successResponse('তালিকা', { type: 'array', items: ref('Dispute') }), ...pick([401, 403]) } });

add({ method: 'patch', path: '/api/disputes/{id}/resolve', tag: 'Dispute', summary: 'অভিযোগ সমাধান (admin)', security: bearerAuth, permission: 'disputes.resolve',
  params: [pathParam('id', 'Dispute ID')],
  requestBody: jsonBody({ type: 'object', required: ['decision'], properties: { decision: { type: 'string', enum: ['RESOLVED', 'REJECTED'] }, resolutionNote: { type: 'string' }, refundCustomer: { type: 'boolean' } } }),
  responses: { ...successResponse('সমাধান হয়েছে', ref('Dispute')), ...pick([400, 401, 403, 404]) } });

// ===== Admin =====
add({ method: 'get', path: '/api/admin/dashboard', tag: 'Admin', summary: '[Deprecated] বেসিক dashboard stats', deprecated: true,
  description: 'পুরনো endpoint — `/api/admin/dashboard/overview` ব্যবহার করুন (cached, বেশি metric)।',
  security: bearerAuth, permission: 'dashboard.view', responses: { ...successResponse('Stats', { type: 'object' }), ...pick([401, 403]) } });

add({ method: 'get', path: '/api/admin/users', tag: 'Admin', summary: 'ইউজার তালিকা', security: bearerAuth, permission: 'users.view',
  params: [queryParam('role', ''), queryParam('search', ''), ...paginationParams],
  responses: { ...successResponse('তালিকা', { type: 'array', items: ref('User') }), ...pick([401, 403]) } });

add({ method: 'patch', path: '/api/admin/users/{id}/toggle-suspension', tag: 'Admin', summary: 'ইউজার সাসপেন্ড/আনসাসপেন্ড', security: bearerAuth, permission: 'users.suspend',
  params: [pathParam('id', 'User ID')], responses: { ...successResponse('আপডেট হয়েছে', ref('User')), ...pick([401, 403, 404]) } });

add({ method: 'get', path: '/api/admin/verifications/pending', tag: 'Admin', summary: 'অপেক্ষমান verification তালিকা', security: bearerAuth, permission: 'providers.view',
  responses: { ...successResponse('তালিকা', { type: 'array', items: ref('User') }), ...pick([401, 403]) } });

add({ method: 'patch', path: '/api/admin/verifications/{userId}/id', tag: 'Admin', summary: 'ID ভেরিফিকেশন রিভিউ', security: bearerAuth, permission: 'providers.verify',
  params: [pathParam('userId', 'User ID')],
  requestBody: jsonBody({ type: 'object', required: ['decision'], properties: { decision: { type: 'string', enum: ['VERIFIED', 'REJECTED'] } } }),
  responses: { ...successResponse('রিভিউ সম্পন্ন', ref('User')), ...pick([401, 403, 422]) } });

add({ method: 'patch', path: '/api/admin/verifications/{userId}/face', tag: 'Admin', summary: 'Face ভেরিফিকেশন রিভিউ', security: bearerAuth, permission: 'providers.verify',
  params: [pathParam('userId', 'User ID')],
  requestBody: jsonBody({ type: 'object', required: ['decision'], properties: { decision: { type: 'string', enum: ['VERIFIED', 'REJECTED'] } } }),
  responses: { ...successResponse('রিভিউ সম্পন্ন', ref('User')), ...pick([401, 403, 422]) } });

add({ method: 'get', path: '/api/admin/providers', tag: 'Admin', summary: 'প্রোভাইডার তালিকা (search/filter/sort/export)', security: bearerAuth, permission: 'providers.view',
  params: [queryParam('search', ''), queryParam('status', ''), queryParam('sort', 'field:asc|desc'), ...paginationParams, queryParam('export', 'csv দিলে CSV ডাউনলোড')],
  responses: { ...successResponse('তালিকা', paginationSchema({ name: 'ProviderProfile', arrayKey: 'providers' })), ...pick([401, 403]) } });

add({ method: 'get', path: '/api/admin/bookings', tag: 'Admin', summary: 'বুকিং তালিকা (search/filter/sort/export)', security: bearerAuth, permission: 'bookings.view',
  params: [queryParam('status', ''), queryParam('from', '', { type: 'string', format: 'date' }), queryParam('to', '', { type: 'string', format: 'date' }), queryParam('sort', ''), ...paginationParams, queryParam('export', 'csv দিলে CSV ডাউনলোড')],
  responses: { ...successResponse('তালিকা', paginationSchema({ name: 'Booking', arrayKey: 'bookings' })), ...pick([401, 403]) } });

// ===== Withdrawal (admin) =====
add({ method: 'get', path: '/api/admin/withdrawals/pending', tag: 'Withdrawal', summary: 'অপেক্ষমান উত্তোলনের অনুরোধ', security: bearerAuth, permission: 'wallet.view',
  responses: { ...successResponse('তালিকা', { type: 'array', items: ref('WithdrawalRequest') }), ...pick([401, 403]) } });

add({ method: 'patch', path: '/api/admin/withdrawals/{transactionId}', tag: 'Withdrawal', summary: '⚠️ উত্তোলন approve/reject — দেখুন Inconsistency Report',
  description: 'Path param-এর নাম `transactionId` কিন্তু এটা আসলে `WithdrawalRequest.id` — legacy নামকরণ, Inconsistency Report-এ বিস্তারিত।',
  security: bearerAuth, permission: 'wallet.approve',
  params: [pathParam('transactionId', 'WithdrawalRequest ID (নামকরণ legacy)')],
  requestBody: jsonBody({ type: 'object', required: ['decision'], properties: { decision: { type: 'string', enum: ['PROCESSED', 'REJECTED'] } } }),
  responses: { ...successResponse('প্রসেস হয়েছে', { type: 'object' }), ...pick([401, 403, 404, 422]) } });

// ===== Reconciliation (admin) =====
add({ method: 'post', path: '/api/admin/reconciliation/run', tag: 'Reconciliation', summary: 'ম্যানুয়াল reconciliation রান', security: bearerAuth, permission: 'payment.reconcile',
  description: 'প্রতি ১৫ মিনিটে auto-চলে; এটা on-demand ট্রিগার।', responses: { ...successResponse('রিপোর্ট', { type: 'object' }), ...pick([401, 403]) } });

add({ method: 'get', path: '/api/admin/reconciliation/queue', tag: 'Reconciliation', summary: 'Manual review queue', security: bearerAuth, permission: 'payment.view',
  params: paginationParams, responses: { ...successResponse('queue', { type: 'object' }), ...pick([401, 403]) } });

add({ method: 'patch', path: '/api/admin/reconciliation/queue/{id}/resolve', tag: 'Reconciliation', summary: 'Manual review item সমাধান', security: bearerAuth, permission: 'payment.reconcile',
  params: [pathParam('id', 'ReconciliationLog ID')], responses: { ...successResponse('সমাধান হয়েছে', { type: 'object' }), ...pick([401, 403, 404]) } });

// ===== Wallet admin =====
add({ method: 'post', path: '/api/admin/wallet/marketing-credit', tag: 'Wallet', summary: 'Referral/cashback/promo credit ম্যানুয়ালি দেওয়া', security: bearerAuth, permission: 'wallet.adjust',
  requestBody: jsonBody({ type: 'object', required: ['userId', 'amount', 'reason'], properties: { userId: { type: 'string' }, amount: { type: 'number' }, reason: { type: 'string', enum: ['REFERRAL_BONUS', 'CASHBACK', 'PROMO_CREDIT'] }, campaignId: { type: 'string' }, note: { type: 'string' } } }),
  responses: { ...successResponse('ক্রেডিট দেওয়া হয়েছে', { type: 'object' }, '201'), ...pick([401, 403, 422]) } });

add({ method: 'post', path: '/api/admin/wallet/adjustment', tag: 'Wallet', summary: 'ম্যানুয়াল ব্যালেন্স সমন্বয় (PLATFORM_REVENUE থেকে)', security: bearerAuth, permission: 'wallet.adjust',
  requestBody: jsonBody({ type: 'object', required: ['userId', 'amount', 'direction', 'note'], properties: { userId: { type: 'string' }, amount: { type: 'number' }, direction: { type: 'string', enum: ['CREDIT', 'DEBIT'] }, note: { type: 'string' } } }),
  responses: { ...successResponse('সমন্বয় সম্পন্ন', { type: 'object' }, '201'), ...pick([401, 403, 404, 422]) } });

add({ method: 'get', path: '/api/admin/wallet/financial-report', tag: 'Analytics', summary: 'Revenue বনাম marketing expense রিপোর্ট', security: bearerAuth, permission: 'reports.view',
  params: [queryParam('from', ''), queryParam('to', '')], responses: { ...successResponse('রিপোর্ট', { type: 'object' }), ...pick([401, 403]) } });

// ===== Coupons (admin + public) =====
add({ method: 'get', path: '/api/admin/coupons', tag: 'Admin', summary: 'কুপন তালিকা', security: bearerAuth, permission: 'coupons.view',
  responses: { ...successResponse('তালিকা', { type: 'array', items: { type: 'object' } }), ...pick([401, 403]) } });

add({ method: 'post', path: '/api/admin/coupons', tag: 'Admin', summary: 'নতুন কুপন তৈরি', security: bearerAuth, permission: 'coupons.manage',
  responses: { ...successResponse('তৈরি হয়েছে', { type: 'object' }, '201'), ...pick([401, 403, 422]) } });

add({ method: 'delete', path: '/api/admin/coupons/{id}', tag: 'Admin', summary: 'কুপন মুছে ফেলা', security: bearerAuth, permission: 'coupons.manage',
  params: [pathParam('id', 'Coupon ID')], responses: { ...successResponse('মুছে ফেলা হয়েছে', { type: 'object' }), ...pick([401, 403, 404]) } });

// ===== Notification admin =====
add({ method: 'get', path: '/api/admin/notifications/templates', tag: 'Notification', summary: 'নোটিফিকেশন টেমপ্লেট তালিকা', security: bearerAuth, permission: 'notifications.view',
  responses: { ...successResponse('তালিকা', { type: 'array', items: { type: 'object' } }), ...pick([401, 403]) } });

add({ method: 'put', path: '/api/admin/notifications/templates/{key}', tag: 'Notification', summary: 'টেমপ্লেট create/update', security: bearerAuth, permission: 'notifications.manage',
  params: [pathParam('key', 'Template key, যেমন booking.created')], responses: { ...successResponse('সেভ হয়েছে', { type: 'object' }), ...pick([401, 403]) } });

add({ method: 'get', path: '/api/admin/notifications/dlq', tag: 'Notification', summary: 'Dead-letter queue দেখা', security: bearerAuth, permission: 'notifications.view',
  responses: { ...successResponse('DLQ items', { type: 'object' }), ...pick([401, 403]) } });

add({ method: 'post', path: '/api/admin/notifications/dlq/{id}/retry', tag: 'Notification', summary: 'DLQ item পুনরায় চেষ্টা', security: bearerAuth, permission: 'notifications.manage',
  params: [pathParam('id', 'Job ID')], responses: { ...successResponse('আবার কিউতে যোগ হয়েছে', { type: 'object' }), ...pick([401, 403, 404]) } });

// ===== System (account, analytics, audit, roles, settings, broadcast) =====
add({ method: 'post', path: '/api/admin/change-password', tag: 'System', summary: 'নিজের admin পাসওয়ার্ড পরিবর্তন', security: bearerAuth,
  description: 'mustChangePassword=true থাকলে এটাই একমাত্র endpoint যেটা কল করা যাবে।',
  requestBody: jsonBody({ type: 'object', required: ['currentPassword', 'newPassword'], properties: { currentPassword: { type: 'string' }, newPassword: { type: 'string', minLength: 8 } } }),
  responses: { ...successResponse('পরিবর্তন হয়েছে', { type: 'object' }), ...pick([401, 422]) } });

add({ method: 'get', path: '/api/admin/dashboard/overview', tag: 'Analytics', summary: 'Dashboard live metrics (cached, 60s TTL)', security: bearerAuth, permission: 'dashboard.view',
  responses: { ...successResponse('Overview metrics', { type: 'object' }), ...pick([401, 403]) } });

for (const [p, summary] of [
  ['revenue', 'Revenue analytics (daily/weekly/monthly)'], ['bookings/trends', 'Booking trends'],
  ['users/growth', 'User growth'], ['providers/growth', 'Provider growth'],
  ['categories/performance', 'Category performance'], ['cities', 'City-wise analytics (approximate)'],
  ['providers/top', 'Top providers'], ['retention', 'Customer retention rate'], ['repeat-booking-rate', 'Repeat booking rate'],
]) {
  add({ method: 'get', path: `/api/admin/analytics/${p}`, tag: 'Analytics', summary, security: bearerAuth, permission: 'reports.view',
    description: p === 'cities' ? 'প্রতিটা customer-এর default saved address-এর city দিয়ে approximate — Booking নিজে city snapshot রাখে না।' : 'Historical trend `DailyMetricsSnapshot`(nightly cron) থেকে, 1hr cache।',
    params: (p.includes('trend') || p === 'revenue' || p.includes('growth')) ? [queryParam('from', ''), queryParam('to', ''), queryParam('period', 'daily|weekly|monthly')] : [],
    responses: { ...successResponse(summary, { type: 'object' }), ...pick([401, 403]) } });
}

add({ method: 'get', path: '/api/admin/permissions', tag: 'System', summary: 'সব Permission-এর তালিকা', security: bearerAuth, permission: 'roles.manage',
  responses: { ...successResponse('তালিকা', { type: 'array', items: { type: 'object' } }), ...pick([401, 403]) } });

add({ method: 'get', path: '/api/admin/roles/matrix', tag: 'System', summary: 'সম্পূর্ণ Role→Permission matrix', security: bearerAuth, permission: 'roles.manage',
  responses: { ...successResponse('matrix', { type: 'object' }), ...pick([401, 403]) } });

add({ method: 'put', path: '/api/admin/roles/{role}/permissions', tag: 'System', summary: 'একটা role-এর permission সেট বদলানো',
  description: 'SUPER_ADMIN-এর permission এই endpoint দিয়ে বদলানো যাবে না (403, hardcoded)।',
  security: bearerAuth, permission: 'roles.manage', params: [pathParam('role', 'ADMIN | FINANCE_ADMIN | SUPPORT_ADMIN | MODERATOR')],
  requestBody: jsonBody({ type: 'object', required: ['permissionKeys'], properties: { permissionKeys: { type: 'array', items: { type: 'string' } } } }),
  responses: { ...successResponse('আপডেট হয়েছে', { type: 'object' }), ...pick([401, 403, 422]) } });

add({ method: 'get', path: '/api/admin/admins', tag: 'System', summary: 'সব admin-এর তালিকা', security: bearerAuth, permission: 'roles.manage',
  responses: { ...successResponse('তালিকা', { type: 'array', items: { type: 'object' } }), ...pick([401, 403]) } });

add({ method: 'post', path: '/api/admin/admins', tag: 'System', summary: 'নতুন admin access দেওয়া',
  description: 'SUPER_ADMIN grant করা যাবে না এই endpoint দিয়ে — বুটস্ট্র্যাপ-only, direct DB access লাগে।',
  security: bearerAuth, permission: 'roles.manage',
  requestBody: jsonBody({ type: 'object', required: ['userId', 'adminRole'], properties: { userId: { type: 'string' }, adminRole: { type: 'string', enum: ['ADMIN', 'FINANCE_ADMIN', 'SUPPORT_ADMIN', 'MODERATOR'] } } }),
  responses: { ...successResponse('access দেওয়া হয়েছে', { type: 'object' }, '201'), ...pick([401, 403, 404, 422]) } });

add({ method: 'patch', path: '/api/admin/admins/{id}/revoke', tag: 'System', summary: 'Admin access বাতিল', security: bearerAuth, permission: 'roles.manage',
  params: [pathParam('id', 'AdminProfile ID')], responses: { ...successResponse('বাতিল হয়েছে', { type: 'object' }), ...pick([401, 403, 404]) } });

add({ method: 'get', path: '/api/admin/audit-logs', tag: 'System', summary: 'Admin audit log (allow+deny সব)', security: bearerAuth, permission: 'audit.view',
  params: [queryParam('adminUserId', ''), queryParam('action', ''), queryParam('targetType', ''), queryParam('from', ''), queryParam('to', ''), ...paginationParams],
  responses: { ...successResponse('তালিকা', { type: 'object' }), ...pick([401, 403]) } });

add({ method: 'get', path: '/api/admin/settings', tag: 'System', summary: 'সিস্টেম সেটিংস তালিকা', security: bearerAuth, permission: 'settings.view',
  responses: { ...successResponse('তালিকা', { type: 'array', items: { type: 'object' } }), ...pick([401, 403]) } });

add({ method: 'put', path: '/api/admin/settings/{key}', tag: 'System', summary: 'সেটিং create/update', security: bearerAuth, permission: 'settings.manage',
  params: [pathParam('key', 'যেমন chat.retention_days')],
  requestBody: jsonBody({ type: 'object', required: ['value'], properties: { value: {}, description: { type: 'string' } } }),
  responses: { ...successResponse('সেভ হয়েছে', { type: 'object' }), ...pick([401, 403, 422]) } });

add({ method: 'post', path: '/api/admin/broadcast', tag: 'System', summary: 'ব্রডকাস্ট নোটিফিকেশন পাঠানো', security: bearerAuth, permission: 'notifications.broadcast',
  requestBody: jsonBody({ type: 'object', required: ['title', 'body'], properties: { userIds: { type: 'array', items: { type: 'string' } }, role: { type: 'string', enum: ['CUSTOMER', 'PROVIDER'] }, title: { type: 'string' }, body: { type: 'string' } } }),
  responses: { ...successResponse('পাঠানো হয়েছে', { type: 'object' }), ...pick([401, 403, 422]) } });

// ===== Chat moderation + policy (admin) =====
add({ method: 'get', path: '/api/admin/chat/conversations', tag: 'Chat', summary: 'কথোপকথন খোঁজা (admin lookup)', security: bearerAuth, permission: 'chat.view',
  params: [queryParam('type', ''), queryParam('status', ''), queryParam('search', ''), ...paginationParams],
  responses: { ...successResponse('তালিকা', { type: 'object' }), ...pick([401, 403]) } });

add({ method: 'get', path: '/api/admin/chat/conversations/{id}/messages', tag: 'Chat', summary: 'কথোপকথনের মেসেজ দেখা (sensitive — audit হয়)', security: bearerAuth, permission: 'chat.view_messages',
  description: '⚠️ প্রতিটা কল `AdminAuditLog`-এ যায়।',
  params: [pathParam('id', 'Conversation ID')], responses: { ...successResponse('মেসেজ', { type: 'array', items: ref('Message') }), ...pick([401, 403]) } });

add({ method: 'patch', path: '/api/admin/chat/conversations/{id}/lock', tag: 'Chat', summary: 'কথোপকথন লক করা', security: bearerAuth, permission: 'chat.moderate',
  params: [pathParam('id', 'Conversation ID')], responses: { ...successResponse('লক হয়েছে', ref('Conversation')), ...pick([401, 403, 404]) } });

add({ method: 'patch', path: '/api/admin/chat/conversations/{id}/archive', tag: 'Chat', summary: 'কথোপকথন আর্কাইভ করা', security: bearerAuth, permission: 'chat.moderate',
  params: [pathParam('id', 'Conversation ID')], responses: { ...successResponse('আর্কাইভ হয়েছে', ref('Conversation')), ...pick([401, 403, 404]) } });

add({ method: 'get', path: '/api/admin/chat/reports', tag: 'Chat', summary: 'মেসেজ রিপোর্ট তালিকা', security: bearerAuth, permission: 'chat.moderate',
  params: [queryParam('status', 'OPEN|REVIEWED|DISMISSED')], responses: { ...successResponse('তালিকা', { type: 'array', items: { type: 'object' } }), ...pick([401, 403]) } });

add({ method: 'patch', path: '/api/admin/chat/reports/{id}', tag: 'Chat', summary: 'রিপোর্ট প্রসেস করা', security: bearerAuth, permission: 'chat.moderate',
  params: [pathParam('id', 'MessageReport ID')],
  requestBody: jsonBody({ type: 'object', required: ['decision'], properties: { decision: { type: 'string', enum: ['REVIEWED', 'DISMISSED'] } } }),
  responses: { ...successResponse('প্রসেস হয়েছে', { type: 'object' }), ...pick([401, 403, 422]) } });

add({ method: 'get', path: '/api/admin/chat/policy', tag: 'Chat', summary: 'Communication Policy দেখা (phase-ভিত্তিক)', security: bearerAuth, permission: 'chat.policy.manage',
  responses: { ...successResponse('policy', { type: 'array', items: { type: 'object' } }), ...pick([401, 403]) } });

add({ method: 'put', path: '/api/admin/chat/policy/{phase}', tag: 'Chat', summary: 'একটা phase-এর policy mode বদলানো (কোড ডিপ্লয় ছাড়াই)', security: bearerAuth, permission: 'chat.policy.manage',
  params: [pathParam('phase', 'BEFORE_BOOKING | DURING_BOOKING | AFTER_BOOKING')],
  requestBody: jsonBody({ type: 'object', required: ['mode'], properties: { mode: { type: 'string', enum: ['OFF', 'WARN', 'REVIEW', 'BLOCK'] } } }),
  responses: { ...successResponse('আপডেট হয়েছে', { type: 'object' }), ...pick([401, 403, 422]) } });

add({ method: 'get', path: '/api/admin/chat/detection-rules', tag: 'Chat', summary: 'Detection rule তালিকা', security: bearerAuth, permission: 'chat.policy.manage',
  responses: { ...successResponse('তালিকা', { type: 'array', items: { type: 'object' } }), ...pick([401, 403]) } });

add({ method: 'put', path: '/api/admin/chat/detection-rules/{key}', tag: 'Chat', summary: 'নতুন detection rule যোগ/আপডেট (কোড ডিপ্লয় ছাড়াই)', security: bearerAuth, permission: 'chat.policy.manage',
  params: [pathParam('key', 'যেমন phone_number')],
  requestBody: jsonBody({ type: 'object', properties: { type: { type: 'string', enum: ['REGEX', 'CUSTOM_FUNCTION', 'ML_MODEL'] }, pattern: { type: 'string' }, description: { type: 'string' }, isActive: { type: 'boolean' } } }),
  responses: { ...successResponse('সেভ হয়েছে', { type: 'object' }), ...pick([401, 403]) } });

// ---------------------------------------------------------------------
// Assemble the OpenAPI document
// ---------------------------------------------------------------------

const paths = {};
for (const e of endpoints) {
  if (!paths[e.path]) paths[e.path] = {};
  paths[e.path][e.method] = {
    tags: [e.tag],
    summary: e.summary,
    description: [
      e.description || '',
      e.permission ? `\n\n**প্রয়োজনীয় permission:** \`${e.permission}\`` : '',
      e.rateLimit ? `\n\n**Rate limit:** ${e.rateLimit}` : '',
      e.deprecated ? '\n\n**⚠️ DEPRECATED**' : '',
    ].filter(Boolean).join(''),
    ...(e.deprecated && { deprecated: true }),
    ...(e.security && { security: e.security }),
    ...(e.params && { parameters: e.params }),
    ...(e.requestBody && { requestBody: e.requestBody }),
    responses: e.responses,
  };
}

const openapi = {
  openapi: '3.1.0',
  info: {
    title: 'Fixify API',
    version: '1.0.0',
    description: 'Fixify service marketplace — সম্পূর্ণ backend API। Versioning policy ও changelog-এর জন্য docs/api/API_VERSIONING.md ও docs/api/CHANGELOG.md দেখুন।',
    contact: { name: 'Fixify Engineering' },
  },
  servers: [
    { url: 'http://localhost:5000', description: 'Local development' },
    { url: 'https://api.fixify.example.com', description: 'Production (replace with actual domain)' },
  ],
  tags: [
    { name: 'Authentication' }, { name: 'User' }, { name: 'Provider' }, { name: 'Address' },
    { name: 'Booking' }, { name: 'Wallet' }, { name: 'Payment' }, { name: 'Notification' },
    { name: 'Chat' }, { name: 'Admin' }, { name: 'Analytics' }, { name: 'Search' },
    { name: 'Dispute' }, { name: 'Withdrawal' }, { name: 'Reconciliation' }, { name: 'System' },
  ],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas,
  },
  paths,
};

const outPath = path.join(__dirname, '..', 'docs', 'api', 'openapi.json');
fs.writeFileSync(outPath, JSON.stringify(openapi, null, 2));
console.log(`Wrote ${outPath} — ${Object.keys(paths).length} paths, ${endpoints.length} operations.`);
