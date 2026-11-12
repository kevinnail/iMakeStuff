// Email: real addresses are far shorter than the RFC 5321 limit of 254, so 100 covers every
// realistic one. Password: an 8 character minimum (the NIST floor, and better-auth's) and a 128
// character maximum, matching better-auth's default so the form never refuses a password the
// server would take.
export const EMAIL_MAX_LENGTH = 100;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// A new password needs a letter and a number, which turns away "11111111" and "password" without
// requiring symbols or capitals.
export function weakPasswordError(password: string): string | null {
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  if (!hasLetter || !hasNumber) {
    return 'Use a mix of letters and numbers.';
  }
  return null;
}

export type CreateAccountField = 'email' | 'password' | 'confirm';

// What's wrong with each field of the create account form. An empty result means it can be sent.
export function getCreateAccountErrors(form: {
  email: string;
  password: string;
  confirm: string;
}): Partial<Record<CreateAccountField, string>> {
  const errors: Partial<Record<CreateAccountField, string>> = {};
  const email = form.email.trim();

  if (!isValidEmail(email)) errors.email = 'Enter a valid email address.';
  else if (email.length > EMAIL_MAX_LENGTH)
    errors.email = `Email can't be over ${EMAIL_MAX_LENGTH} characters.`;

  if (form.password.length < PASSWORD_MIN_LENGTH)
    errors.password = `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  else if (form.password.length > PASSWORD_MAX_LENGTH)
    errors.password = `Password can't be over ${PASSWORD_MAX_LENGTH} characters.`;
  else {
    const weak = weakPasswordError(form.password);
    if (weak) errors.password = weak;
  }

  if (form.confirm !== form.password) errors.confirm = 'Passwords do not match.';

  return errors;
}

export type SignInField = 'email' | 'password';

// What's wrong with each field of the sign in form. The password is only checked for being
// there: its rules belong to creating one, and the server decides whether it's right.
export function getSignInErrors(form: {
  email: string;
  password: string;
}): Partial<Record<SignInField, string>> {
  const errors: Partial<Record<SignInField, string>> = {};

  if (!isValidEmail(form.email.trim())) errors.email = 'Enter a valid email address.';
  if (form.password.length === 0) errors.password = 'Enter your password.';

  return errors;
}
