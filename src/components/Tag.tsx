import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme';

interface TagProps {
  label: string;
  // For a row with a colored fill.
  onFill?: boolean;
}

// Marks prep or a lost piece wherever it's listed alongside pieces.
export function Tag({ label, onFill = false }: TagProps) {
  return (
    <View style={[styles.tag, onFill && styles.tagOnFill]}>
      <Text style={[styles.text, onFill && styles.textOnFill]}>{label}</Text>
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
