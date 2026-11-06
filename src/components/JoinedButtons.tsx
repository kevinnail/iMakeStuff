import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors } from '@/theme';

interface JoinedButtonsProps<Value extends string> {
  options: { value: Value; label: string; color?: string }[];
  selected: Value;
  onSelect: (value: Value) => void;

  style?: StyleProp<ViewStyle>;
}

// A row of joined buttons with one selected, like iOS's segmented control.
export function JoinedButtons<Value extends string>({
  options,
  selected,
  onSelect,
  style,
}: JoinedButtonsProps<Value>) {
  return (
    <View style={[styles.row, style]}>
      {options.map(({ value, label, color }) => (
        <Pressable
          key={value}
          style={[
            styles.button,
            selected === value && styles.buttonSelected,
            selected === value && color !== undefined && { backgroundColor: color },
          ]}
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
