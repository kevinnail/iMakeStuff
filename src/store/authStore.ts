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
}

// better-auth requires a name on every account, but EvenCraft never shows or uses one, so it's
// the part of the email before the @.
function deriveName(email: string): string {
  const local = email.split('@')[0]?.trim();
  return local && local.length > 0 ? local : email;
}

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

    const { data, error } = await authClient.signUp.email({
      email: trimmed,
      password,
      name: deriveName(trimmed),
    });

    if (error || !data) {
      set({ status: 'signed-out', email: null, userId: null, error: messageFromAuthError(error) });
      return false;
    }

    set({ status: 'signed-in', email: trimmed, userId: data.user.id, error: null });
    return true;
  },
}));
