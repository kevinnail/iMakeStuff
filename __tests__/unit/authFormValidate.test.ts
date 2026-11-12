import {
  EMAIL_MAX_LENGTH,
  getCreateAccountErrors,
  getSignInErrors,
  isValidEmail,
  PASSWORD_MAX_LENGTH,
  weakPasswordError,
} from '@/utils/authFormValidate';

describe('getSignInErrors', () => {
  // Otherwise an account made before a password rule changed could never sign in again.
  it('finds nothing wrong with an email and any password', () => {
    expect(getSignInErrors({ email: '  maker@example.com  ', password: 'x' })).toEqual({});
  });

  // Otherwise an empty form goes to the server and the maker sees its error instead of what to fix.
  it('names both fields wrong on an empty form', () => {
    expect(getSignInErrors({ email: '', password: '' })).toEqual({
      email: 'Enter a valid email address.',
      password: 'Enter your password.',
    });
  });
});

const goodForm = { email: 'maker@example.com', password: 'glass2026', confirm: 'glass2026' };

describe('isValidEmail', () => {
  // Otherwise a normal address is refused and the maker can't create an account at all.
  it('accepts a normal address', () => {
    expect(isValidEmail('maker@example.com')).toBe(true);
  });

  // Otherwise a mistyped address goes to the server and becomes an account nobody can reset.
  it('refuses a missing @, a missing domain, spaces, and an empty box', () => {
    expect(isValidEmail('maker.example.com')).toBe(false);
    expect(isValidEmail('maker@')).toBe(false);
    expect(isValidEmail('ma ker@example.com')).toBe(false);
    expect(isValidEmail('')).toBe(false);
  });
});

describe('weakPasswordError', () => {
  // Otherwise "11111111" or "password" guards a backup of everything the maker has recorded.
  it('refuses all digits or all letters', () => {
    expect(weakPasswordError('11111111')).toBe('Use a mix of letters and numbers.');
    expect(weakPasswordError('password')).toBe('Use a mix of letters and numbers.');
  });

  // Otherwise a reasonable password is refused for no reason the maker can see.
  it('accepts letters mixed with numbers', () => {
    expect(weakPasswordError('glass2026')).toBeNull();
  });
});

describe('getCreateAccountErrors', () => {
  // Otherwise a correctly filled form is blocked from being sent.
  it('finds nothing wrong with a good form, even with spaces around the email', () => {
    expect(getCreateAccountErrors({ ...goodForm, email: '  maker@example.com  ' })).toEqual({});
  });

  // Otherwise an empty form gets sent and the maker sees the server's error instead of what to fix.
  it('names every field wrong on an empty form', () => {
    expect(getCreateAccountErrors({ email: '', password: '', confirm: 'x' })).toEqual({
      email: 'Enter a valid email address.',
      password: 'Password must be at least 8 characters.',
      confirm: 'Passwords do not match.',
    });
  });

  // Otherwise the form sends a password the server refuses as too long, or an email past the cap.
  it('refuses an email and a password over their caps', () => {
    const longPassword = `a1${'b'.repeat(PASSWORD_MAX_LENGTH - 1)}`;
    const errors = getCreateAccountErrors({
      email: `${'m'.repeat(EMAIL_MAX_LENGTH)}@example.com`,
      password: longPassword,
      confirm: longPassword,
    });
    expect(errors).toEqual({
      email: `Email can't be over ${EMAIL_MAX_LENGTH} characters.`,
      password: `Password can't be over ${PASSWORD_MAX_LENGTH} characters.`,
    });
  });

  // Otherwise a long enough password of only digits gets through without the letter and number rule.
  it('refuses a weak password that is long enough', () => {
    expect(
      getCreateAccountErrors({ ...goodForm, password: '12345678', confirm: '12345678' }),
    ).toEqual({ password: 'Use a mix of letters and numbers.' });
  });
});
