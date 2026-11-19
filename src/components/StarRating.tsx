import { Host, Image } from '@expo/ui/swift-ui';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors } from '@/theme';

const grades = [1, 2, 3, 4, 5];

interface StarRatingProps {
  rating: number | null;
  onChange: (rating: number | null) => void;
}

// How well a piece was made, never required. Tapping a star grades it that many; tapping the
// last filled star again takes the grade off.
export function StarRating({ rating, onChange }: StarRatingProps) {
  return (
    <View style={styles.row}>
      {grades.map((grade) => (
        <Pressable
          key={grade}
          style={({ pressed }) => [styles.star, pressed && styles.pressed]}
          onPress={() => onChange(grade === rating ? null : grade)}
        >
          {/* Taps pass through the icon to the button around it. */}
          <Host style={styles.icon} alignment="center" pointerEvents="none">
            <Image
              systemName={rating !== null && grade <= rating ? 'star.fill' : 'star'}
              size={28}
              color={colors.primary}
            />
          </Host>
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
});
