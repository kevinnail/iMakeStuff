import { authClient } from '@/services/authClient';
import { messageFromAuthError, useAuthStore } from '@/store/authStore';

jest.mock('@/services/authClient', () => ({
  authClient: {
    signUp: { email: jest.fn() },
  },
}));

const signUpEmailMock = authClient.signUp.email as unknown as jest.Mock;

const signedOut = { status: 'signed-out', email: null, userId: null, error: null } as const;

beforeEach(() => {
  useAuthStore.setState(signedOut);
  signUpEmailMock.mockReset();
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
});
