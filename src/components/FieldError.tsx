import { useState } from 'react';
import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';

import { colors } from '@/theme';
import type { MissingField } from '@/utils/missingFields';

// The form's missing fields, shown only once Save has been tapped, so a form isn't red before
// anything is typed. Each one clears as soon as it's filled in. check() is Save's first step: it
// shows them and says whether there were none.
export function useMissingFields(missing: MissingField[]) {
  const [checked, setChecked] = useState(false);
  return {
    shown: checked ? missing : [],
    check() {
      setChecked(true);
      return missing.length === 0;
    },
  };
}

// Red text under a field that Save found missing. style spaces it where it sits on a card.
export function FieldError({ message, style }: { message: string; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.error, style]}>{message}</Text>;
}

const styles = StyleSheet.create({
  error: {
    fontSize: 16,
    color: colors.danger,
  },
});
