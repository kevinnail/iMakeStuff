import { Host, Image } from '@expo/ui/swift-ui';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { colors } from '@/theme';

const grades = [1, 2, 3, 4, 5];
// How long a fading grade stays filled in, then how long it takes to fade.
const fadeDelayMilliseconds = 250;
const fadeMilliseconds = 900;

interface StarRatingProps {
  rating: number | null;
  onChange: (rating: number | null) => void;
  // On the running row of a run: the row's text color, and off while a lap saves.
  color?: string;
  disabled?: boolean;
  // The grade a star lap just saved, filled in over the stars and then faded out.
  fadingRating?: number | null;
}

// How well a piece was made, never required. Tapping a star grades it that many; tapping the
// last filled star again takes the grade off.
export function StarRating({
  rating,
  onChange,
  color = colors.primary,
  disabled = false,
  fadingRating = null,
}: StarRatingProps) {
  const fadingOpacity = useSharedValue(0);
  const fadingStyle = useAnimatedStyle(() => ({ opacity: fadingOpacity.get() }));

  // Reanimated skips a delay when the phone's Reduce Motion is on, which would hide the grade at
  // once. A hold isn't motion, so it holds either way.
  useEffect(() => {
    if (fadingRating === null) return;
    fadingOpacity.set(
      withSequence(
        withTiming(1, { duration: 0 }),
        withDelay(
          fadeDelayMilliseconds,
          withTiming(0, { duration: fadeMilliseconds }),
          ReduceMotion.Never,
        ),
      ),
    );
  }, [fadingRating, fadingOpacity]);

  return (
    <View style={styles.row}>
      {grades.map((grade) => (
        <Pressable
          key={grade}
          style={({ pressed }) => [styles.star, pressed && styles.pressed]}
          onPress={() => onChange(grade === rating ? null : grade)}
          disabled={disabled}
        >
          {/* Taps pass through the icon to the button around it. */}
          <Host style={styles.icon} alignment="center" pointerEvents="none">
            <Image
              systemName={rating !== null && grade <= rating ? 'star.fill' : 'star'}
              size={28}
              color={color}
            />
          </Host>
          {fadingRating !== null && grade <= fadingRating && (
            <Animated.View style={[styles.fadingIcon, fadingStyle]} pointerEvents="none">
              <Host style={styles.icon} alignment="center">
                <Image systemName="star.fill" size={28} color={color} />
              </Host>
            </Animated.View>
          )}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
  },
  star: {
    padding: 4,
  },
  pressed: {
    opacity: 0.6,
  },
  icon: {
    width: 32,
    height: 32,
  },
  // Over the empty star, inside the star's padding.
  fadingIcon: {
    position: 'absolute',
    top: 4,
    left: 4,
  },
});
