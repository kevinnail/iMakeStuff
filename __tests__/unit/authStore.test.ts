import { authClient } from '@/services/authClient';
import { messageFromAuthError, useAuthStore } from '@/store/authStore';

jest.mock('@/services/authClient', () => ({
  authClient: {
    signUp: { email: jest.fn() },
    signIn: { email: jest.fn() },
    signOut: jest.fn(),
  },
}));

const signUpEmailMock = authClient.signUp.email as unknown as jest.Mock;
const signInEmailMock = authClient.signIn.email as unknown as jest.Mock;
const signOutMock = authClient.signOut as unknown as jest.Mock;

const signedOut = { status: 'signed-out', email: null, userId: null, error: null } as const;
const signedIn = {
  status: 'signed-in',
  email: 'maker@example.com',
  userId: 'user-1',
  error: null,
} as const;

beforeEach(() => {
  useAuthStore.setState(signedOut);
  signUpEmailMock.mockReset();
  signInEmailMock.mockReset();
  signOutMock.mockReset();
});

describe('authStore.signIn', () => {
  // Otherwise the right password leaves the Backup tab still offering Sign In.
  it('signs in with the trimmed email and the password', async () => {
    signInEmailMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });

    const result = await useAuthStore.getState().signIn('  maker@example.com  ', 'glass2026');

    expect(result).toBe(true);
    expect(signInEmailMock).toHaveBeenCalledWith({
      email: 'maker@example.com',
      password: 'glass2026',
    });
    expect(useAuthStore.getState()).toEqual(expect.objectContaining(signedIn));
  });

  // Otherwise a wrong password looks signed in, or the maker never learns why it was refused.
  it('stays signed out with the server message when the password is wrong', async () => {
    signInEmailMock.mockResolvedValue({
      data: null,
      error: { message: 'Invalid email or password', status: 401 },
    });

    const result = await useAuthStore.getState().signIn('maker@example.com', 'wrong2026');

    expect(result).toBe(false);
    expect(useAuthStore.getState()).toEqual(
      expect.objectContaining({ ...signedOut, error: 'Invalid email or password' }),
    );
  });

  // Otherwise a phone with no connection throws out of sign in and leaves the Sign In button disabled.
  it('stays signed out with a connection message when the server is unreachable', async () => {
    signInEmailMock.mockRejectedValue(new TypeError('Network request failed'));

    const result = await useAuthStore.getState().signIn('maker@example.com', 'glass2026');

    expect(result).toBe(false);
    expect(useAuthStore.getState()).toEqual(
      expect.objectContaining({
        ...signedOut,
        error: 'Could not reach the server. Check your connection and try again.',
      }),
    );
  });
});

describe('authStore.signOut', () => {
  // Otherwise the Backup tab still shows "Signed in as" after signing out.
  it('signs out', async () => {
    useAuthStore.setState(signedIn);
    signOutMock.mockResolvedValue({ data: { success: true }, error: null });

    const result = await useAuthStore.getState().signOut();

    expect(result).toBe(true);
    expect(useAuthStore.getState()).toEqual(expect.objectContaining(signedOut));
  });

  // Otherwise the phone looks signed out while its session is still live on the server.
  it('stays signed in with a connection message when the server is unreachable', async () => {
    useAuthStore.setState(signedIn);
    signOutMock.mockRejectedValue(new TypeError('Network request failed'));

    const result = await useAuthStore.getState().signOut();

    expect(result).toBe(false);
    expect(useAuthStore.getState()).toEqual(
      expect.objectContaining({
        ...signedIn,
        error: 'Could not reach the server. Check your connection and try again.',
      }),
    );
  });
});

describe('authStore.setSession', () => {
  // Otherwise the maker has to sign in again every time the app is opened.
  it('signs in from a session kept on the phone', () => {
    useAuthStore.getState().setSession({ user: { id: 'user-1', email: 'maker@example.com' } });

    expect(useAuthStore.getState()).toEqual(expect.objectContaining(signedIn));
  });

  // Otherwise a session that ended on the server keeps showing "Signed in as".
  it('signs out when there is no session', () => {
    useAuthStore.setState(signedIn);

    useAuthStore.getState().setSession(null);

    expect(useAuthStore.getState()).toEqual(expect.objectContaining(signedOut));
  });
});

describe('messageFromAuthError', () => {
  // Otherwise the server's reason, like an email already in use, never reaches the screen.
  it("uses the server's message", () => {
    expect(messageFromAuthError({ message: 'User already exists. Use another email.' })).toBe(
      'User already exists. Use another email.',
    );
  });

  // Otherwise a failure with no message shows an empty pop-up box.
  it('falls back to a general message when there is none', () => {
    expect(messageFromAuthError(null)).toBe('Something went wrong. Please try again.');
    expect(messageFromAuthError({ status: 500 })).toBe('Something went wrong. Please try again.');
  });
});

describe('authStore.signUp', () => {
  // Otherwise the account is made under an email with stray spaces, or better-auth refuses it for having no name.
  it('sends the trimmed email, the password, and a name from the email', async () => {
    signUpEmailMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });

    await useAuthStore.getState().signUp('  Maker@Example.com  ', 'glass2026');

    expect(signUpEmailMock).toHaveBeenCalledTimes(1);
    expect(signUpEmailMock).toHaveBeenCalledWith({
      email: 'Maker@Example.com',
      password: 'glass2026',
      name: 'Maker',
    });
  });

  // Otherwise the Backup tab still offers Create Account after the account exists.
  it('signs in to the new account', async () => {
    signUpEmailMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });

    const created = await useAuthStore.getState().signUp('maker@example.com', 'glass2026');

    expect(created).toBe(true);
    expect(useAuthStore.getState()).toEqual(
      expect.objectContaining({
        status: 'signed-in',
        email: 'maker@example.com',
        userId: 'user-1',
        error: null,
      }),
    );
  });

  // Otherwise a refused sign up looks signed in, or the maker never learns the email is taken.
  it('stays signed out with the server message when the email is taken', async () => {
    signUpEmailMock.mockResolvedValue({
      data: null,
      error: { message: 'User already exists. Use another email.', status: 422 },
    });

    const created = await useAuthStore.getState().signUp('maker@example.com', 'glass2026');

    expect(created).toBe(false);
    expect(useAuthStore.getState()).toEqual(
      expect.objectContaining({ ...signedOut, error: 'User already exists. Use another email.' }),
    );
  });

  // Otherwise a phone with no connection throws out of sign up and leaves the Create Account button disabled.
  it('stays signed out with a connection message when the server is unreachable', async () => {
    signUpEmailMock.mockRejectedValue(new TypeError('Network request failed'));

    const created = await useAuthStore.getState().signUp('maker@example.com', 'glass2026');

    expect(created).toBe(false);
    expect(useAuthStore.getState()).toEqual(
      expect.objectContaining({
        ...signedOut,
        error: 'Could not reach the server. Check your connection and try again.',
      }),
    );
  });
});
