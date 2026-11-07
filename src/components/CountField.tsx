import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors } from '@/theme';
import { parseSize, type BatchSize, type SizeInput } from '@/utils/prepTime';

export interface CountTexts {
  amountText: string;
  unitText: string;
}

// Counted prep is made as a number of equal parts; by eye prep is one thing used by guessing.
export type PrepKind = 'counted' | 'byEye';

interface CountFieldProps {
  label: string;
  amountPlaceholder: string;
  unitPlaceholder: string;
  note?: string;
  texts: CountTexts;
  onChange: (texts: CountTexts) => void;
}

interface PrepKindFieldProps {
  kind: PrepKind;
  onChangeKind: (kind: PrepKind) => void;
  texts: CountTexts;
  onChangeTexts: (texts: CountTexts) => void;
}

export const noCount: SizeInput = { sizeAmount: null, sizeUnit: null };

export const prepCountError = "Enter how many it made, like 8 points, or tap I didn't count it.";

export function getPrepKind({ size_amount }: BatchSize): PrepKind {
  return size_amount === null ? 'byEye' : 'counted';
}

// The boxes' starting text for a saved count, empty when there's none.
export function getCountTexts({ size_amount, size_unit }: BatchSize): CountTexts {
  return { amountText: size_amount === null ? '' : String(size_amount), unitText: size_unit ?? '' };
}

// A count typed as a number and a unit, like 8 points, or null unless both read.
export function readCount({ amountText, unitText }: CountTexts): SizeInput | null {
  const sizeAmount = parseSize(amountText);
  const sizeUnit = unitText.trim();
  return sizeAmount === null || sizeUnit === '' ? null : { sizeAmount, sizeUnit };
}

// The count a prep is saved with: none by eye, or null when Counted has no count typed.
export function readPrepCount(kind: PrepKind, texts: CountTexts): SizeInput | null {
  return kind === 'byEye' ? noCount : readCount(texts);
}

// A number and a unit the maker types: what a counted prep made. The app never interprets the
// unit.
export function CountField({
  label,
  amountPlaceholder,
  unitPlaceholder,
  note,
  texts,
  onChange,
}: CountFieldProps) {
  return (
    <View style={styles.field}>
      <View style={styles.row}>
        <Text style={[styles.label, styles.fill]}>{label}</Text>
        <TextInput
          style={[styles.input, styles.amountInput]}
          value={texts.amountText}
          onChangeText={(amountText) => onChange({ ...texts, amountText })}
          placeholder={amountPlaceholder}
          placeholderTextColor={colors.secondaryText}
          keyboardType="decimal-pad"
        />
        <TextInput
          style={[styles.input, styles.unitInput]}
          value={texts.unitText}
          onChangeText={(unitText) => onChange({ ...texts, unitText })}
          placeholder={unitPlaceholder}
          placeholderTextColor={colors.secondaryText}
          autoCapitalize="none"
        />
      </View>
      {note && <Text style={styles.note}>{note}</Text>}
    </View>
  );
}

// How many parts prep made, asked up front since that's what a piece's cost is divided from. A
// cane that isn't counted is by eye: pieces guess how much they took.
export function PrepKindField({ kind, onChangeKind, texts, onChangeTexts }: PrepKindFieldProps) {
  return (
    <View style={styles.field}>
      {kind === 'counted' ? (
        <CountField
          label="How many did it make?"
          amountPlaceholder="8"
          unitPlaceholder="points"
          texts={texts}
          onChange={onChangeTexts}
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
