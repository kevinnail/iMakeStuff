import { HStack, Image, Overlay, Spacer, Text } from '@expo/ui/swift-ui';
import {
  fixedSize,
  font,
  foregroundStyle,
  hidden,
  lineLimit,
  monospacedDigit,
  padding,
} from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity } from 'expo-widgets';

import type { WorkTimerContent } from '@/utils/workTimer';

function WorkTimerLayout(content: WorkTimerContent) {
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
  const icon = <Image systemName="stopwatch.fill" color={content.color} />;
  const title = (size: number) => (
    <Text modifiers={[font({ size, weight: 'semibold' }), lineLimit(1)]}>{content.title}</Text>
  );

  return {
    banner: (
      <HStack spacing={12} modifiers={[padding({ all: 16 })]}>
        {icon}
        {title(20)}
        <Spacer />
        {timer(32)}
      </HStack>
    ),
    compactLeading: icon,
    compactTrailing: timer(16),
    minimal: icon,
    expandedLeading: (
      <HStack spacing={8}>
        {icon}
        {title(18)}
      </HStack>
    ),
    expandedTrailing: timer(28),
  };
}

export const workTimerActivity = createLiveActivity<WorkTimerContent>('WorkTimer', WorkTimerLayout);

export async function showWorkTimer(content: WorkTimerContent | null): Promise<void> {
  const [current, ...extra] = workTimerActivity.getInstances();
  for (const activity of extra) await activity.end('immediate');
  if (!content) {
    // Immediate, since a finished timer left on the Lock Screen would keep counting.
    if (current) await current.end('immediate');
    return;
  }
  if (current) await current.update(content);
  else workTimerActivity.start(content);
}
