import { HStack, Image, Overlay, Spacer, Text } from '@expo/ui/swift-ui';
import {
  clipShape,
  fixedSize,
  font,
  foregroundStyle,
  frame,
  hidden,
  lineLimit,
  monospacedDigit,
  padding,
  resizable,
} from '@expo/ui/swift-ui/modifiers';
import { File } from 'expo-file-system';
import { createLiveActivity, widgetsDirectory } from 'expo-widgets';
import { Image as ReactNativeImage } from 'react-native';

import type { WorkTimerContent } from '@/utils/workTimer';

interface WorkTimerActivityContent extends WorkTimerContent {
  iconUri: string;
}

function WorkTimerLayout(content: WorkTimerActivityContent) {
  'widget';

  const timer = (size: number) => (
    <Overlay alignment="trailing" modifiers={[fixedSize()]}>
      <Text modifiers={[hidden(), font({ size, weight: 'semibold' }), monospacedDigit()]}>
        0:00:00
      </Text>
      <Overlay.Content>
        <Text
          date={new Date(content.countingFrom)}
          dateStyle="timer"
          modifiers={[
            font({ size, weight: 'semibold' }),
            monospacedDigit(),
            foregroundStyle(content.color),
          ]}
        />
      </Overlay.Content>
    </Overlay>
  );
  const icon = (size: number) => (
    <Image
      uiImage={content.iconUri}
      modifiers={[
        resizable(),
        frame({ width: size, height: size }),
        clipShape('roundedRectangle', size * 0.22),
      ]}
    />
  );
  const title = (size: number) => (
    <Text modifiers={[font({ size, weight: 'semibold' }), lineLimit(1)]}>{content.title}</Text>
  );

  return {
    banner: (
      <HStack spacing={12} modifiers={[padding({ all: 16 })]}>
        {icon(40)}
        {title(20)}
        <Spacer />
        {timer(32)}
      </HStack>
    ),
    compactLeading: icon(24),
    compactTrailing: timer(16),
    minimal: icon(24),
    expandedLeading: (
      <HStack spacing={8}>
        {icon(32)}
        {title(18)}
      </HStack>
    ),
    expandedTrailing: timer(28),
  };
}

export const workTimerActivity = createLiveActivity<WorkTimerActivityContent>(
  'WorkTimer',
  WorkTimerLayout,
);

// The Live Activity runs outside the app and can only read files in the shared widgets folder.
const iconFile = new File(widgetsDirectory, 'live-activity-icon.png');

// Copied on every start so the shared folder always holds the icon from the installed version.
async function copyIcon(): Promise<void> {
  // Only an empty source resolves to undefined, and a bundled image never is one.
  const { uri } = ReactNativeImage.resolveAssetSource(
    require('../../assets/live-activity-icon.png'),
  )!;
  // A dev build loads the image from Metro; an App Store build has it as a file inside the app.
  if (uri.startsWith('http')) await File.downloadFileAsync(uri, iconFile, { idempotent: true });
  else await new File(uri).copy(iconFile, { overwrite: true });
}

export async function showWorkTimer(content: WorkTimerContent | null): Promise<void> {
  const [current, ...extra] = workTimerActivity.getInstances();
  for (const activity of extra) await activity.end('immediate');
  if (!content) {
    // Immediate, since a finished timer left on the Lock Screen would keep counting.
    if (current) await current.end('immediate');
    return;
  }
  const activityContent = { ...content, iconUri: iconFile.uri };
  if (current) {
    await current.update(activityContent);
    return;
  }
  await copyIcon();
  workTimerActivity.start(activityContent);
}
