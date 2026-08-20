const {
  sendOtpSchema,
  signupSchema,
  loginSchema,
  emailLoginSchema,
  socialLoginSchema,
} = require('../../src/validators/authValidators');

describe('sendOtpSchema', () => {
  test('accepts a valid BD phone number', () => {
    expect(sendOtpSchema.safeParse({ phone: '01712345678' }).success).toBe(true);
  });
  test('accepts +880 prefixed phone', () => {
    expect(sendOtpSchema.safeParse({ phone: '+8801712345678' }).success).toBe(true);
  });
  test('rejects an invalid phone number', () => {
    expect(sendOtpSchema.safeParse({ phone: '12345' }).success).toBe(false);
  });
  test('rejects missing phone', () => {
    expect(sendOtpSchema.safeParse({}).success).toBe(false);
  });
});

describe('signupSchema', () => {
  const base = { phone: '01712345678', otp: '123456', name: 'Test User', password: 'Password123' };

  test('accepts valid minimal signup', () => {
    expect(signupSchema.safeParse(base).success).toBe(true);
  });
  test('rejects OTP that is not 6 digits', () => {
    expect(signupSchema.safeParse({ ...base, otp: '123' }).success).toBe(false);
  });
  test('rejects password under 8 characters', () => {
    expect(signupSchema.safeParse({ ...base, password: 'short' }).success).toBe(false);
  });
  test('rejects invalid role', () => {
    expect(signupSchema.safeParse({ ...base, role: 'ADMIN' }).success).toBe(false);
  });
  test('accepts optional referralCode', () => {
    expect(signupSchema.safeParse({ ...base, referralCode: 'ABC123' }).success).toBe(true);
  });
});

describe('loginSchema', () => {
  test('accepts phone + password', () => {
    expect(loginSchema.safeParse({ phone: '01712345678', password: 'x' }).success).toBe(true);
  });
  test('rejects empty password', () => {
    expect(loginSchema.safeParse({ phone: '01712345678', password: '' }).success).toBe(false);
  });
});

describe('emailLoginSchema', () => {
  test('accepts valid email + password', () => {
    expect(emailLoginSchema.safeParse({ email: 'a@b.com', password: 'x' }).success).toBe(true);
  });
  test('rejects invalid email', () => {
    expect(emailLoginSchema.safeParse({ email: 'not-an-email', password: 'x' }).success).toBe(false);
  });
});

describe('socialLoginSchema', () => {
  test('accepts provider + token', () => {
    expect(socialLoginSchema.safeParse({ provider: 'GOOGLE', token: 'a'.repeat(20) }).success).toBe(true);
  });
  test('rejects unsupported provider', () => {
    expect(socialLoginSchema.safeParse({ provider: 'TWITTER', token: 'a'.repeat(20) }).success).toBe(false);
  });
  test('rejects token shorter than 10 chars', () => {
    expect(socialLoginSchema.safeParse({ provider: 'GOOGLE', token: 'short' }).success).toBe(false);
  });
  test('accepts optional fullName for Apple', () => {
    const result = socialLoginSchema.safeParse({ provider: 'APPLE', token: 'a'.repeat(20), fullName: 'Jane Doe' });
    expect(result.success).toBe(true);
  });
});
