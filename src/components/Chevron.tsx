import { StyleSheet, Text } from 'react-native';

import { colors } from '@/theme';

// Ends a row that opens something when tapped, the way iOS lists do.
export function Chevron() {
  return <Text style={styles.chevron}>›</Text>;
}

const styles = StyleSheet.create({
  chevron: {
    fontSize: 24,
    lineHeight: 24,
    color: colors.secondaryText,
  },
});
