import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { useEffect } from 'react';

import { FirstRunGuide } from '@/components/FirstRunGuide';
import { authClient } from '@/services/authClient';
import { useAuthStore } from '@/store/authStore';
import { colors } from '@/theme';

// Colors the headers, back buttons, and every screen's background.
const navigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.primary,
    background: colors.background,
    card: colors.background,
    text: colors.text,
    border: colors.separator,
  },
};

export default function RootLayout() {
  // better-auth reads the session kept in the Keychain once when the app opens. Copying it into
  // the store is what keeps the phone signed in across restarts.
  const setSession = useAuthStore((state) => state.setSession);
  const { data: session, isPending } = authClient.useSession();

  useEffect(() => {
    if (isPending) return;
    setSession(session);
  }, [session, isPending, setSession]);

  return (
    <ThemeProvider value={navigationTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="piece/[id]" options={{ headerBackButtonDisplayMode: 'minimal' }} />
        <Stack.Screen name="day/[dayStart]" options={{ headerBackButtonDisplayMode: 'minimal' }} />
        <Stack.Screen
          name="add-work"
          options={{ title: 'Add Work', headerBackButtonDisplayMode: 'minimal' }}
        />
        <Stack.Screen
          name="supplies"
          options={{ title: 'Supplies', headerBackButtonDisplayMode: 'minimal' }}
        />
        <Stack.Screen name="supply/[id]" options={{ headerBackButtonDisplayMode: 'minimal' }} />
        <Stack.Screen
          name="create-account"
          options={{ title: 'Create Account', headerBackButtonDisplayMode: 'minimal' }}
        />
        <Stack.Screen
          name="sign-in"
          options={{ title: 'Sign In', headerBackButtonDisplayMode: 'minimal' }}
        />
      </Stack>
      <FirstRunGuide />
    </ThemeProvider>
  );
}
