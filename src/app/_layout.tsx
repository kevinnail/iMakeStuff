import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="piece/[id]" options={{ headerBackButtonDisplayMode: 'minimal' }} />
      <Stack.Screen name="day/[dayStart]" options={{ headerBackButtonDisplayMode: 'minimal' }} />
    </Stack>
  );
}
