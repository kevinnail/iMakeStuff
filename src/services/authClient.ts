import { createAuthClient } from 'better-auth/react';
import { expoClient } from '@better-auth/expo/client';
import * as SecureStore from 'expo-secure-store';

import { getBackendBaseUrl } from '@/constants/runtime';

// better-auth's client for Expo. The expoClient plugin keeps the session cookie in the Keychain
// through expo-secure-store and adds it to every auth request. better-auth mounts under
// /api/auth, so the base URL is the server's root.
export const authClient = createAuthClient({
  baseURL: getBackendBaseUrl(),
  plugins: [
    expoClient({
      scheme: 'evencraft',
      storagePrefix: 'evencraft',
      storage: SecureStore,
    }),
  ],
});
