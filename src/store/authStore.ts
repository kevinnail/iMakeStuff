import { create } from 'zustand';

import { authClient } from '@/services/authClient';

export type AuthStatus = 'signed-out' | 'signed-in';

interface AuthState {
  status: AuthStatus;
  email: string | null;
  // The signed in account's id, which the backup's rows belong to.
  userId: string | null;
  error: string | null;
  // Creates an account and signs in to it. False on failure, with error set.
  signUp: (email: string, password: string) => Promise<boolean>;
  // Signs in to an existing account. False on failure, with error set.
  signIn: (email: string, password: string) => Promise<boolean>;
  // Ends the session on the server and in the Keychain. The phone's data stays as it is.
  // False on failure, with error set, and still signed in.
  signOut: () => Promise<boolean>;
  // Copies better-auth's session into the store, so a session kept in the Keychain signs the
  // app back in when it opens.
  setSession: (session: { user: { id: string; email: string } } | null) => void;
}

// better-auth requires a name on every account, but EvenCraft never shows or uses one, so it's
// the part of the email before the @.
function deriveName(email: string): string {
  const local = email.split('@')[0]?.trim();
  return local && local.length > 0 ? local : email;
}

const UNREACHABLE_MESSAGE = 'Could not reach the server. Check your connection and try again.';

export function messageFromAuthError(
  error: { message?: string; status?: number } | null | undefined,
): string {
  if (error?.message && error.message.length > 0) return error.message;
  return 'Something went wrong. Please try again.';
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'signed-out',
  email: null,
  userId: null,
  error: null,

  signUp: async (email, password) => {
    const trimmed = email.trim();
    set({ error: null });

    // better-auth throws, instead of returning an error, when the server can't be reached.
    const { data, error } = await authClient.signUp
      .email({ email: trimmed, password, name: deriveName(trimmed) })
      .catch(() => ({ data: null, error: { message: UNREACHABLE_MESSAGE } }));

    if (error || !data) {
      set({ status: 'signed-out', email: null, userId: null, error: messageFromAuthError(error) });
      return false;
    }

    set({ status: 'signed-in', email: trimmed, userId: data.user.id, error: null });
    return true;
  },

  signIn: async (email, password) => {
    const trimmed = email.trim();
    set({ error: null });

    const { data, error } = await authClient.signIn
      .email({ email: trimmed, password })
      .catch(() => ({ data: null, error: { message: UNREACHABLE_MESSAGE } }));

    if (error || !data) {
      set({ status: 'signed-out', email: null, userId: null, error: messageFromAuthError(error) });
      return false;
    }

    set({ status: 'signed-in', email: trimmed, userId: data.user.id, error: null });
    return true;
  },

  signOut: async () => {
    set({ error: null });

    const { error } = await authClient
      .signOut()
      .catch(() => ({ error: { message: UNREACHABLE_MESSAGE } }));

    if (error) {
      set({ error: messageFromAuthError(error) });
      return false;
    }

    set({ status: 'signed-out', email: null, userId: null });
    return true;
  },

  setSession: (session) => {
    if (session) {
      set({ status: 'signed-in', email: session.user.email, userId: session.user.id });
    } else {
      set({ status: 'signed-out', email: null, userId: null });
    }
  },
}));
