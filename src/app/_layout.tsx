import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { FirstRunGuide } from '@/components/FirstRunGuide';
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
  // Swipeable rows need the gesture root around the whole app.
  return (
    <GestureHandlerRootView style={styles.root}>
      <ThemeProvider value={navigationTheme}>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="piece/[id]" options={{ headerBackButtonDisplayMode: 'minimal' }} />
          <Stack.Screen
            name="day/[dayStart]"
            options={{ headerBackButtonDisplayMode: 'minimal' }}
          />
          <Stack.Screen
            name="add-work"
            options={{ title: 'Add Work', headerBackButtonDisplayMode: 'minimal' }}
          />
          <Stack.Screen
            name="supplies"
            options={{ title: 'Supplies', headerBackButtonDisplayMode: 'minimal' }}
          />
          <Stack.Screen name="supply/[id]" options={{ headerBackButtonDisplayMode: 'minimal' }} />
        </Stack>
        <FirstRunGuide />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
