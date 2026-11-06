import { Children, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors } from '@/theme';

export function Card({ children }: { children: ReactNode }) {
  return (
    <View style={styles.card}>
      {Children.toArray(children).map((row, index) => (
        <View key={index} style={index > 0 && styles.separator}>
          {row}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  separator: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
});
