import { Tabs } from 'expo-router';

export default function TabLayout() {
  return (
    <Tabs>
      <Tabs.Screen name="index" options={{ title: 'Work' }} />
      <Tabs.Screen name="pieces" options={{ title: 'Pieces' }} />
      <Tabs.Screen name="days" options={{ title: 'Days' }} />
    </Tabs>
  );
}
