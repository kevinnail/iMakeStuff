import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Dropdown } from '@/components/Dropdown';
import type { AvailablePrep } from '@/db/queries/prepQueries';
import { colors } from '@/theme';
import { parseAmount } from '@/utils/prepTime';

export interface PrepUseChoice {
  prep: { id: number; name: string; otherPiecesPercent: number; usedUp: boolean };
  estimatedPercent: number;
  note?: string;
  useId?: number;
  fromTemplate?: boolean;
}

interface PrepUsePanelProps {
  // Adding a use: the prep to choose from. Changing one: null.
  prepList: AvailablePrep[] | null;
  // Changing a use: it as saved. Adding one: null.
  initial: PrepUseChoice | null;
  onCancel: () => void;
  onSave: (choice: PrepUseChoice) => void;
  onRemove?: () => void;
}

export function PrepUsePanel({ prepList, initial, onCancel, onSave, onRemove }: PrepUsePanelProps) {
  const insets = useSafeAreaInsets();
  const [chosenPrep, setChosenPrep] = useState(initial?.prep ?? null);
  const [amountText, setAmountText] = useState(initial ? String(initial.estimatedPercent) : '');
  const typedPercent = parseAmount(amountText);
  // A fraction shows the percent it saves as, so rounding down is never a surprise.
  const unitText = !amountText.includes('/')
    ? '%'
    : typedPercent === null
      ? ''
      : `= ${typedPercent}%`;
  const canSave = chosenPrep !== null && amountText !== '';

  function handleSave() {
    if (chosenPrep === null) return;
    if (typedPercent === null) {
      Alert.alert('Enter a percent from 1 to 100, or a fraction like 1/8.');
      return;
    }
    const choice = { prep: chosenPrep, estimatedPercent: typedPercent };
    const total = chosenPrep.otherPiecesPercent + typedPercent;
    if (chosenPrep.usedUp || total < 100) {
      onSave(choice);
      return;
    }
    Alert.alert(
      `Use up ${chosenPrep.name}?`,
      total === 100
        ? 'This brings it to 100%, so saving marks it used up.'
        : `This brings it to ${total}%. Saving marks it used up and scales every piece's share to add up to 100%.`,
      [
        { text: 'Change amount', style: 'cancel' },
        { text: 'Mark used up', onPress: () => onSave(choice) },
      ],
    );
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
      <KeyboardAvoidingView style={styles.overlay} behavior="padding">
        <View style={[styles.panel, { paddingBottom: insets.bottom + 16 }]}>
          <Text style={styles.title}>{initial ? initial.prep.name : 'Add prep'}</Text>
          {prepList && prepList.length === 0 && (
            <Text style={styles.secondaryText}>No finished prep to use.</Text>
          )}
          {prepList && prepList.length > 0 && (
            <Dropdown
              options={prepList.map((prep) => ({
                key: prep.id,
                label: prep.name,
                detail: `${Math.max(0, 100 - prep.used_percent)}% left`,
                prep,
              }))}
              selectedKey={chosenPrep?.id ?? null}
              placeholder="Choose prep"
              onSelect={({ prep }) =>
                setChosenPrep({
                  id: prep.id,
                  name: prep.name,
                  otherPiecesPercent: prep.used_percent,
                  usedUp: false,
                })
              }
            />
          )}
          {chosenPrep && (
            <View style={styles.fieldRow}>
              <Text style={[styles.label, styles.amountLabel]}>How much this piece took</Text>
              <TextInput
                style={styles.amountInput}
                value={amountText}
                onChangeText={setAmountText}
                placeholder="1/8"
                placeholderTextColor={colors.secondaryText}
                keyboardType="numbers-and-punctuation"
                autoFocus={!initial}
              />
              <Text style={[styles.label, styles.unitText]}>{unitText}</Text>
            </View>
          )}
          <View style={styles.buttonRow}>
            {onRemove && (
              <Pressable style={[styles.textButton, styles.removeButton]} onPress={onRemove}>
                <Text style={styles.removeButtonText}>Remove</Text>
              </Pressable>
            )}
            <Pressable style={styles.textButton} onPress={onCancel}>
              <Text style={styles.textButtonText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.saveButton, !canSave && styles.buttonDisabled]}
              onPress={handleSave}
              disabled={!canSave}
            >
              <Text style={styles.saveButtonText}>{initial ? 'Save' : 'Add'}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  panel: {
    maxHeight: '85%',
    padding: 16,
    gap: 12,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    backgroundColor: colors.surface,
  },
  title: {
    fontSize: 20,
    color: colors.text,
  },
  secondaryText: {
    fontSize: 18,
    color: colors.secondaryText,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    fontSize: 18,
    color: colors.text,
  },
  amountLabel: {
    flex: 1,
  },
  amountInput: {
    width: 88,
    fontSize: 18,
    padding: 8,
    textAlign: 'right',
    color: colors.text,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.separator,
    borderRadius: 8,
  },
  // Wide enough for "= 100%", so the box doesn't shift as a fraction is typed.
  unitText: {
    width: 72,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  textButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  textButtonText: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.text,
  },
  removeButton: {
    marginRight: 'auto',
    paddingHorizontal: 0,
  },
  removeButtonText: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.accent,
  },
  saveButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  saveButtonText: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.textOnFill,
  },
});
