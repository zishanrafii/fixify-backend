const { OAuth2Client } = require('google-auth-library');
const appleSignin = require('apple-signin-auth');
const axios = require('axios');

function unauthorized(message) {
  const err = new Error(message);
  err.statusCode = 401;
  return err;
}

function notConfigured(message) {
  const err = new Error(message);
  err.statusCode = 500;
  return err;
}

// ---------------------------------------------------------------------------
// Google — verified with Google's official google-auth-library. It fetches
// Google's public keys itself, checks the signature, issuer, audience and
// expiration internally; we re-check the fields explicitly below too as
// defense-in-depth and to make the requirements traceable in code.
// ---------------------------------------------------------------------------
const googleClientIds = (process.env.GOOGLE_CLIENT_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const googleClient = new OAuth2Client();

async function verifyGoogleToken(idToken) {
  if (googleClientIds.length === 0) {
    throw notConfigured('Google sign-in is not configured (GOOGLE_CLIENT_IDS missing)');
  }

  let ticket;
  try {
    ticket = await googleClient.verifyIdToken({ idToken, audience: googleClientIds });
  } catch (err) {
    throw unauthorized('Invalid Google token');
  }

  const payload = ticket.getPayload();
  if (!payload) throw unauthorized('Invalid Google token');

  if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') {
    throw unauthorized('Invalid Google token issuer');
  }
  if (!googleClientIds.includes(payload.aud)) throw unauthorized('Invalid Google token audience');
  if (!payload.exp || payload.exp * 1000 < Date.now()) throw unauthorized('Google token expired');
  if (!payload.sub) throw unauthorized('Google token missing subject');
  if (!payload.email_verified) throw unauthorized('Google account email is not verified');

  return {
    providerId: payload.sub,
    email: payload.email || null,
    emailVerified: true,
    name: payload.name || null,
    avatarUrl: payload.picture || null,
  };
}

// ---------------------------------------------------------------------------
// Apple — verified with apple-signin-auth, which fetches Apple's JWKS and
// checks signature, issuer (https://appleid.apple.com), audience and
// expiration. NOTE: Apple's ID token never contains name/picture — Apple only
// hands those to the client once, on the very first authorization, and there
// is no server-verifiable source for them. We accept an optional, UNVERIFIED
// `fullName` for that one-time first-signup case only; it is never used to
// overwrite an existing linked account.
// ---------------------------------------------------------------------------
async function verifyAppleToken(idToken) {
  const clientId = process.env.APPLE_CLIENT_ID;
  if (!clientId) throw notConfigured('Apple sign-in is not configured (APPLE_CLIENT_ID missing)');

  let payload;
  try {
    payload = await appleSignin.verifyIdToken(idToken, {
      audience: clientId,
      ignoreExpiration: false,
    });
  } catch (err) {
    throw unauthorized('Invalid Apple token');
  }

  if (!payload || !payload.sub) throw unauthorized('Invalid Apple token');

  return {
    providerId: payload.sub,
    email: payload.email || null,
    emailVerified: payload.email_verified === true || payload.email_verified === 'true',
    name: null,
    avatarUrl: null,
  };
}

// ---------------------------------------------------------------------------
// Facebook — verified via the Graph API debug_token endpoint using our own
// app-access-token (never trusting the token's claimed validity), then a
// separate /me call to fetch the actual profile, cross-checked against the
// user_id returned by debug_token.
// ---------------------------------------------------------------------------
async function verifyFacebookToken(accessToken) {
  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  if (!appId || !appSecret) throw notConfigured('Facebook login is not configured');

  const appAccessToken = `${appId}|${appSecret}`;

  let debugData;
  try {
    const res = await axios.get('https://graph.facebook.com/debug_token', {
      params: { input_token: accessToken, access_token: appAccessToken },
    });
    debugData = res.data && res.data.data;
  } catch (err) {
    throw unauthorized('Invalid Facebook token');
  }

  if (!debugData || !debugData.is_valid) throw unauthorized('Invalid or expired Facebook token');
  if (String(debugData.app_id) !== String(appId)) throw unauthorized('Facebook token was not issued for this app');
  if (debugData.expires_at && debugData.expires_at * 1000 < Date.now()) throw unauthorized('Facebook token expired');

  let profile;
  try {
    const res = await axios.get('https://graph.facebook.com/me', {
      params: { fields: 'id,name,email,picture', access_token: accessToken },
    });
    profile = res.data;
  } catch (err) {
    throw unauthorized('Could not fetch Facebook profile');
  }

  if (!profile || String(profile.id) !== String(debugData.user_id)) {
    throw unauthorized('Facebook profile did not match verified token');
  }

  return {
    providerId: profile.id,
    email: profile.email || null,
    emailVerified: !!profile.email, // Facebook only returns email once confirmed
    name: profile.name || null,
    avatarUrl: profile.picture && profile.picture.data ? profile.picture.data.url : null,
  };
}

module.exports = { verifyGoogleToken, verifyAppleToken, verifyFacebookToken };
