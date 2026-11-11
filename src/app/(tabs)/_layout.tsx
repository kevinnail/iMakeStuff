import { NativeTabs } from 'expo-router/native-tabs';

import { colors } from '@/theme';

// iOS's own tab bar, with SF Symbols icons that fill in when the tab is selected.
export default function TabLayout() {
  return (
    <NativeTabs tintColor={colors.primary}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon sf={{ default: 'stopwatch', selected: 'stopwatch.fill' }} />
        <NativeTabs.Trigger.Label>Work</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="pieces">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'square.grid.2x2', selected: 'square.grid.2x2.fill' }}
        />
        <NativeTabs.Trigger.Label>Pieces</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="days">
        <NativeTabs.Trigger.Icon sf="calendar" />
        <NativeTabs.Trigger.Label>Days</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="backup">
        <NativeTabs.Trigger.Icon sf={{ default: 'icloud', selected: 'icloud.fill' }} />
        <NativeTabs.Trigger.Label>Backup</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
