import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { FieldError } from '@/components/FieldError';
import { colors } from '@/theme';
import { missingMessages, type MissingField } from '@/utils/missingFields';
import { parseSize, type BatchSize, type SizeInput } from '@/utils/prepTime';

export interface CountTexts {
  amountText: string;
  unitText: string;
}

// Counted prep is made as a number of equal parts; by eye prep is one thing used by guessing.
export type PrepKind = 'counted' | 'byEye';

interface CountFieldProps {
  label: string;
  note: string;
  texts: CountTexts;
  onChange: (texts: CountTexts) => void;
  // Save found the number or the unit missing.
  missingNumber: boolean;
  missingUnit: boolean;
}

interface PrepKindFieldProps {
  kind: PrepKind;
  onChangeKind: (kind: PrepKind) => void;
  texts: CountTexts;
  onChangeTexts: (texts: CountTexts) => void;
  // The form's missing fields as Save shows them.
  missing: MissingField[];
}

export const noCount: SizeInput = { sizeAmount: null, sizeUnit: null };

export function getPrepKind({ size_amount }: BatchSize): PrepKind {
  return size_amount === null ? 'byEye' : 'counted';
}

// The boxes' starting text for a saved count, empty when there's none.
export function getCountTexts({ size_amount, size_unit }: BatchSize): CountTexts {
  return { amountText: size_amount === null ? '' : String(size_amount), unitText: size_unit ?? '' };
}

// The count a prep is saved with: none by eye. Read after Save's check (getPieceMissing), so a
// counted one's number and unit both read.
export function readPrepCount(kind: PrepKind, { amountText, unitText }: CountTexts): SizeInput {
  return kind === 'byEye'
    ? noCount
    : { sizeAmount: parseSize(amountText)!, sizeUnit: unitText.trim() };
}

// A number and a unit the maker types: what a counted prep made. The app never interprets the
// unit. The boxes start empty, since an example in them reads as filled in; the example is the
// note under them, which Save's message replaces when either is missing.
export function CountField({
  label,
  note,
  texts,
  onChange,
  missingNumber,
  missingUnit,
}: CountFieldProps) {
  return (
    <View style={styles.field}>
      <View style={styles.row}>
        <Text style={[styles.label, styles.fill]}>{label}</Text>
        <TextInput
          style={[styles.input, styles.amountInput, missingNumber && styles.missingInput]}
          value={texts.amountText}
          onChangeText={(amountText) => onChange({ ...texts, amountText })}
          keyboardType="decimal-pad"
        />
        <TextInput
          style={[styles.input, styles.unitInput, missingUnit && styles.missingInput]}
          value={texts.unitText}
          onChangeText={(unitText) => onChange({ ...texts, unitText })}
          autoCapitalize="none"
        />
      </View>
      {missingNumber || missingUnit ? (
        <FieldError message={missingMessages.countNumber} />
      ) : (
        <Text style={styles.note}>{note}</Text>
      )}
    </View>
  );
}

// How many parts prep made, asked up front since that's what a piece's cost is divided from. A
// cane that isn't counted is by eye: pieces guess how much they took.
export function PrepKindField({
  kind,
  onChangeKind,
  texts,
  onChangeTexts,
  missing,
}: PrepKindFieldProps) {
  return (
    <View style={styles.field}>
      {kind === 'counted' ? (
        <CountField
          label="How many did it make?"
          note="Like 8 points."
          texts={texts}
          onChange={onChangeTexts}
          missingNumber={missing.includes('countNumber')}
          missingUnit={missing.includes('countUnit')}
        />
      ) : (
        <Text style={styles.label}>Not counted: each piece guesses how much of it went in.</Text>
      )}
      <Pressable
        style={({ pressed }) => [styles.switchButton, pressed && styles.buttonPressed]}
        onPress={() => onChangeKind(kind === 'counted' ? 'byEye' : 'counted')}
      >
        <Text style={styles.switchText}>
          {kind === 'counted' ? "I didn't count it" : 'Count it instead'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: 8,
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
  missingInput: {
    borderColor: colors.danger,
  },
  note: {
    fontSize: 16,
    color: colors.secondaryText,
  },
  switchButton: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  buttonPressed: {
    opacity: 0.6,
  },
  switchText: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.primary,
  },
});
