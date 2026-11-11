import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Dropdown } from '@/components/Dropdown';
import { FieldError } from '@/components/FieldError';
import { getSizeUnits } from '@/db/queries/prepQueries';
import { colors } from '@/theme';
import { missingMessages, type MissingField } from '@/utils/missingFields';
import { parseSize, type BatchSize, type SizeInput } from '@/utils/prepTime';
import { showError } from '@/utils/showError';

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

// A saved unit is never empty, so the empty key can't clash with one.
const newUnitKey = '';

const unitHelp =
  'The unit is what you split it into, like points, beads, or cm. Each piece then enters how many it used, and its share of the cost comes from that.';

// A number and a unit: what a counted prep made. The app never interprets the unit. The unit is
// picked from those saved before, or typed after New unit; with none saved, it's typed. The boxes
// start empty, since an example in them reads as filled in; the example is the note under them,
// which Save's message replaces when either is missing. The ? shows what the unit is for.
export function CountField({
  label,
  note,
  texts,
  onChange,
  missingNumber,
  missingUnit,
}: CountFieldProps) {
  // null until loaded.
  const [savedUnits, setSavedUnits] = useState<string[] | null>(null);
  const [typingNewUnit, setTypingNewUnit] = useState(false);
  const [showingHelp, setShowingHelp] = useState(false);
  const hasSavedUnits = savedUnits !== null && savedUnits.length > 0;
  const unitOptions = [
    ...(savedUnits ?? []).map((unit) => ({ key: unit, label: unit })),
    { key: newUnitKey, label: 'New unit' },
  ];

  useEffect(() => {
    getSizeUnits().then(setSavedUnits).catch(showError('Could not load your units'));
  }, []);

  // New unit empties the unit so it's typed fresh; a saved one fills it in.
  function chooseUnit(unit: string) {
    setTypingNewUnit(unit === newUnitKey);
    onChange({ ...texts, unitText: unit });
  }

  return (
    <View style={styles.field}>
      <View style={styles.row}>
        <Text style={[styles.label, styles.fill]}>{label}</Text>
        <Pressable
          style={({ pressed }) => [styles.helpButton, pressed && styles.buttonPressed]}
          onPress={() => setShowingHelp(!showingHelp)}
        >
          <Text style={styles.helpButtonText}>?</Text>
        </Pressable>
      </View>
      <View style={styles.row}>
        <TextInput
          style={[styles.input, styles.amountInput, missingNumber && styles.missingInput]}
          value={texts.amountText}
          onChangeText={(amountText) => onChange({ ...texts, amountText })}
          keyboardType="decimal-pad"
        />
        {hasSavedUnits && (
          <View style={styles.fill}>
            <Dropdown
              options={unitOptions}
              selectedKey={typingNewUnit ? newUnitKey : texts.unitText || null}
              placeholder="Unit"
              onSelect={(option) => chooseUnit(option.key)}
              floating
            />
          </View>
        )}
        {savedUnits !== null && (!hasSavedUnits || typingNewUnit) && (
          <TextInput
            style={[
              styles.input,
              hasSavedUnits ? styles.unitInput : styles.fill,
              missingUnit && styles.missingInput,
            ]}
            value={texts.unitText}
            onChangeText={(unitText) => onChange({ ...texts, unitText })}
            autoCapitalize="none"
            autoFocus={typingNewUnit}
          />
        )}
      </View>
      {missingNumber || missingUnit ? (
        <FieldError message={missingMessages.countNumber} />
      ) : (
        <Text style={styles.note}>{note}</Text>
      )}
      {showingHelp && <Text style={styles.note}>{unitHelp}</Text>}
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
  helpButton: {
    paddingVertical: 2,
    paddingHorizontal: 9,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 12,
  },
  helpButtonText: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.primary,
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
