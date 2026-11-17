import { Host, Image } from '@expo/ui/swift-ui';
import type { ComponentProps, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';

import { colors } from '@/theme';

export interface SwipeAction {
  label: string;
  // An SF Symbol, like the icons on the tab bar.
  icon: NonNullable<ComponentProps<typeof Image>['systemName']>;
  // The circle's fill. Plain actions leave it out and get the neutral one.
  color?: string;
  onPress: () => void;
}

interface SwipeRowProps {
  actions: SwipeAction[];
  // The color under the row's content, for a row with no fill of its own, so the buttons stay
  // hidden until it's swiped.
  backgroundColor?: string;
  // A rounded row's corners, so the buttons behind it don't show at them.
  containerStyle?: StyleProp<ViewStyle>;
  children: ReactNode;
}

// Swiping a row left shows its buttons on the right, the way Mail does: a round icon with its
// label under it, the last one at the edge. A button closes the row, then does its job.
export function SwipeRow({ actions, backgroundColor, containerStyle, children }: SwipeRowProps) {
  return (
    <ReanimatedSwipeable
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      containerStyle={containerStyle}
      childrenContainerStyle={backgroundColor ? { backgroundColor } : undefined}
      renderRightActions={(_progress, _translation, swipeableMethods) => (
        <View style={styles.actions}>
          {actions.map(({ label, icon, color, onPress }) => (
            <Pressable
              key={label}
              style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
              onPress={() => {
                swipeableMethods.close();
                onPress();
              }}
            >
              <View style={[styles.circle, color !== undefined && { backgroundColor: color }]}>
                {/* Taps pass through the icon to the button around it. */}
                <Host style={styles.icon} alignment="center" pointerEvents="none">
                  <Image
                    systemName={icon}
                    size={20}
                    color={color === undefined ? colors.text : colors.textOnFill}
                  />
                </Host>
              </View>
              <Text style={styles.label}>{label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    >
      {children}
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  action: {
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
  },
  actionPressed: {
    opacity: 0.6,
  },
  circle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.separator,
  },
  icon: {
    width: 24,
    height: 24,
  },
  label: {
    fontSize: 16,
    lineHeight: 18,
    color: colors.text,
  },
});
