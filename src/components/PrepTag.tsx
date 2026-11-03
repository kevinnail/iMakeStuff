import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme';

// Marks prep wherever it's listed alongside pieces. onFill is for a row with a primary fill.
export function PrepTag({ onFill = false }: { onFill?: boolean }) {
  return (
    <View style={[styles.tag, onFill && styles.tagOnFill]}>
      <Text style={[styles.text, onFill && styles.textOnFill]}>Prep</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: {
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderRadius: 6,
    borderColor: colors.secondaryText,
  },
  tagOnFill: {
    borderColor: colors.textOnFill,
  },
  text: {
    fontSize: 16,
    lineHeight: 18,
    color: colors.secondaryText,
  },
  textOnFill: {
    color: colors.textOnFill,
  },
});
