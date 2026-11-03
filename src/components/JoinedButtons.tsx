import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme';

interface JoinedButtonsProps<Value extends string> {
  options: { value: Value; label: string }[];
  selected: Value;
  onSelect: (value: Value) => void;
}

// A row of joined buttons with one selected, like iOS's segmented control.
export function JoinedButtons<Value extends string>({
  options,
  selected,
  onSelect,
}: JoinedButtonsProps<Value>) {
  return (
    <View style={styles.row}>
      {options.map(({ value, label }) => (
        <Pressable
          key={value}
          style={[styles.button, selected === value && styles.buttonSelected]}
          onPress={() => onSelect(value)}
        >
          <Text style={[styles.text, selected === value && styles.textSelected]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    padding: 2,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  button: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 6,
  },
  buttonSelected: {
    backgroundColor: colors.primary,
  },
  text: {
    fontSize: 14,
    lineHeight: 18,
    textAlign: 'center',
    color: colors.text,
  },
  textSelected: {
    color: colors.textOnFill,
  },
});
