import { StyleSheet, Text, TextInput, View } from 'react-native';

import { colors } from '@/theme';
import { parseSize, type BatchSize, type SizeInput } from '@/utils/prepTime';

interface SizeFieldProps {
  amountText: string;
  unitText: string;
  onChangeAmount: (text: string) => void;
  onChangeUnit: (text: string) => void;
}

export function readSize(amountText: string, unitText: string): SizeInput | null {
  const unit = unitText.trim();
  if (amountText.trim() === '' && unit === '') return { sizeAmount: null, sizeUnit: null };
  const sizeAmount = parseSize(amountText);
  return sizeAmount === null || unit === '' ? null : { sizeAmount, sizeUnit: unit };
}

export const sizeError = 'Enter a size like 8 and a unit like points, or leave both empty.';

// The boxes' starting text for a saved size, empty when there's none.
export function getSizeTexts({ size_amount, size_unit }: BatchSize) {
  return { amountText: size_amount === null ? '' : String(size_amount), unitText: size_unit ?? '' };
}

// Measured in: a prep's size in the maker's own unit. With one, uses are entered in
// that unit and cost is exact; without one, they're percents settled when it's all used.
export function SizeField({ amountText, unitText, onChangeAmount, onChangeUnit }: SizeFieldProps) {
  return (
    <View style={styles.field}>
      <View style={styles.row}>
        <Text style={[styles.label, styles.fill]}>Measured in</Text>
        <TextInput
          style={[styles.input, styles.amountInput]}
          value={amountText}
          onChangeText={onChangeAmount}
          placeholder="8"
          placeholderTextColor={colors.secondaryText}
          keyboardType="decimal-pad"
        />
        <TextInput
          style={[styles.input, styles.unitInput]}
          value={unitText}
          onChangeText={onChangeUnit}
          placeholder="points"
          placeholderTextColor={colors.secondaryText}
          autoCapitalize="none"
        />
      </View>
      <Text style={styles.note}>
        Leave empty to estimate with percents and settle it when you&apos;re done with it.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  fill: {
    flex: 1,
  },
  label: {
    fontSize: 18,
    color: colors.text,
  },
  input: {
    fontSize: 18,
    padding: 8,
    color: colors.text,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.separator,
    borderRadius: 8,
  },
  amountInput: {
    width: 72,
    textAlign: 'right',
  },
  unitInput: {
    width: 110,
  },
  note: {
    fontSize: 16,
    color: colors.secondaryText,
  },
});
