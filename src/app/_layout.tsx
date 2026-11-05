import { DarkTheme, Stack, ThemeProvider } from 'expo-router';

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
      </Stack>
    </ThemeProvider>
  );
}
