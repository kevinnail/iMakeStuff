import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme';

interface TagProps {
  label: string;
  // For a row with a colored fill.
  onFill?: boolean;
  // For a record missing something, like a piece with no cost.
  warning?: boolean;
}

// Marks prep, a lost piece, or a piece with no cost wherever it's listed alongside pieces.
export function Tag({ label, onFill = false, warning = false }: TagProps) {
  return (
    <View style={[styles.tag, onFill && styles.tagOnFill]}>
      <Text style={[styles.text, onFill && styles.textOnFill, warning && styles.textWarning]}>
        {' '}
        - {label} -
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: {
    paddingVertical: 2,
    paddingHorizontal: 8,
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
  textWarning: {
    color: colors.warning,
  },
});
