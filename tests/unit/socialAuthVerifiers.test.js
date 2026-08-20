jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: jest.fn(),
  })),
}));
jest.mock('apple-signin-auth', () => ({ verifyIdToken: jest.fn() }));
jest.mock('axios');

const axios = require('axios');
const appleSignin = require('apple-signin-auth');
const { OAuth2Client } = require('google-auth-library');

process.env.GOOGLE_CLIENT_IDS = 'client-id-1,client-id-2';
process.env.APPLE_CLIENT_ID = 'com.fixify.app';
process.env.FACEBOOK_APP_ID = 'fb-app-id';
process.env.FACEBOOK_APP_SECRET = 'fb-app-secret';

// re-require after env vars are set, since the module reads them at load time
const { verifyGoogleToken, verifyAppleToken, verifyFacebookToken } = require('../../src/services/socialAuthVerifiers');

describe('verifyGoogleToken', () => {
  test('returns a normalized profile for a valid, verified token', async () => {
    const mockClient = OAuth2Client.mock.results[0].value;
    mockClient.verifyIdToken.mockResolvedValue({
      getPayload: () => ({
        iss: 'https://accounts.google.com',
        aud: 'client-id-1',
        exp: Math.floor(Date.now() / 1000) + 3600,
        sub: 'google-sub-123',
        email: 'a@b.com',
        email_verified: true,
        name: 'A B',
        picture: 'https://pic',
      }),
    });

    const profile = await verifyGoogleToken('valid-token');
    expect(profile).toEqual({
      providerId: 'google-sub-123', email: 'a@b.com', emailVerified: true, name: 'A B', avatarUrl: 'https://pic',
    });
  });

  test('rejects when email is not verified', async () => {
    const mockClient = OAuth2Client.mock.results[0].value;
    mockClient.verifyIdToken.mockResolvedValue({
      getPayload: () => ({
        iss: 'https://accounts.google.com', aud: 'client-id-1',
        exp: Math.floor(Date.now() / 1000) + 3600, sub: 'sub', email_verified: false,
      }),
    });
    await expect(verifyGoogleToken('t')).rejects.toMatchObject({ statusCode: 401 });
  });

  test('rejects on library verification failure', async () => {
    const mockClient = OAuth2Client.mock.results[0].value;
    mockClient.verifyIdToken.mockRejectedValue(new Error('bad signature'));
    await expect(verifyGoogleToken('t')).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe('verifyAppleToken', () => {
  test('returns a normalized profile (no name/picture — Apple never provides them)', async () => {
    appleSignin.verifyIdToken.mockResolvedValue({ sub: 'apple-sub', email: 'a@b.com', email_verified: 'true' });
    const profile = await verifyAppleToken('valid-token');
    expect(profile).toEqual({ providerId: 'apple-sub', email: 'a@b.com', emailVerified: true, name: null, avatarUrl: null });
  });

  test('rejects on verification failure', async () => {
    appleSignin.verifyIdToken.mockRejectedValue(new Error('invalid'));
    await expect(verifyAppleToken('t')).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe('verifyFacebookToken', () => {
  test('returns a normalized profile for a valid token matching the configured app', async () => {
    axios.get
      .mockResolvedValueOnce({ data: { data: { is_valid: true, app_id: 'fb-app-id', user_id: 'fb-user-1' } } })
      .mockResolvedValueOnce({ data: { id: 'fb-user-1', name: 'A B', email: 'a@b.com', picture: { data: { url: 'https://pic' } } } });

    const profile = await verifyFacebookToken('valid-token');
    expect(profile).toEqual({
      providerId: 'fb-user-1', email: 'a@b.com', emailVerified: true, name: 'A B', avatarUrl: 'https://pic',
    });
  });

  test('rejects when token is invalid', async () => {
    axios.get.mockResolvedValueOnce({ data: { data: { is_valid: false } } });
    await expect(verifyFacebookToken('t')).rejects.toMatchObject({ statusCode: 401 });
  });

  test('rejects when token belongs to a different app', async () => {
    axios.get.mockResolvedValueOnce({ data: { data: { is_valid: true, app_id: 'someone-elses-app', user_id: 'u1' } } });
    await expect(verifyFacebookToken('t')).rejects.toMatchObject({ statusCode: 401 });
  });
});
