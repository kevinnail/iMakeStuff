import { Pressable, StyleSheet, Text } from 'react-native';

import { colors } from '@/theme';

interface LostButtonProps {
  lost: boolean;
  onChange: (lost: boolean) => void;
}

export function LostButton({ lost, onChange }: LostButtonProps) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.button,
        lost && styles.buttonOn,
        pressed && styles.buttonPressed,
      ]}
      onPress={() => onChange(!lost)}
    >
      <Text style={[styles.text, lost && styles.textOn]}>{lost ? 'Lost' : 'Mark as lost'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 2,
    borderColor: colors.danger,
    borderRadius: 8,
  },
  buttonOn: {
    backgroundColor: colors.danger,
  },
  buttonPressed: {
    opacity: 0.6,
  },
  text: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.danger,
  },
  textOn: {
    color: colors.textOnFill,
  },
});
