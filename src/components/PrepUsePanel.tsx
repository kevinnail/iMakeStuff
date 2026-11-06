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
import {
  formatPercent,
  formatShare,
  getShareValue,
  parseAmount,
  usesUpPrep,
  type Share,
} from '@/utils/prepTime';

export interface PrepUseChoice {
  // otherPiecesShare: every other piece's share of it added together, 1 being all of it.
  prep: { id: number; name: string; otherPiecesShare: number; usedUp: boolean };
  share: Share;
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
  const [amountText, setAmountText] = useState(initial ? formatShare(initial.share) : '');
  const typedShare = parseAmount(amountText);
  // A bare number typed in is a percent, so it gets "%" after it. An empty box, a fraction, or a
  // typed % gets none, so a fraction never sits beside a percent likesign.
  const unitText = amountText !== '' && !/[/%]/.test(amountText) ? '%' : '';
  const canSave = chosenPrep !== null && amountText !== '';

  function handleSave() {
    if (chosenPrep === null) return;
    if (typedShare === null) {
      Alert.alert('Enter a percent from 1 to 100, or a fraction like 1/8.');
      return;
    }
    const choice = { prep: chosenPrep, share: typedShare };
    const total = chosenPrep.otherPiecesShare + getShareValue(typedShare);
    if (chosenPrep.usedUp || !usesUpPrep(total)) {
      onSave(choice);
      return;
    }
    const totalText = formatPercent(total);
    Alert.alert(
      `Use up ${chosenPrep.name}?`,
      totalText === '100%'
        ? 'This brings it to 100%, so saving marks it used up.'
        : `This brings it to ${totalText}. Saving marks it used up and scales every piece's share to add up to 100%.`,
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
                detail: `${formatPercent(Math.max(0, 1 - prep.used_share))} left`,
                prep,
              }))}
              selectedKey={chosenPrep?.id ?? null}
              placeholder="Choose prep"
              onSelect={({ prep }) =>
                setChosenPrep({
                  id: prep.id,
                  name: prep.name,
                  otherPiecesShare: prep.used_share,
                  usedUp: false,
                })
              }
            />
          )}
          {chosenPrep && (
            <>
              <View style={styles.fieldRow}>
                <Text style={[styles.label, styles.amountLabel]}>How much this piece took</Text>
                <TextInput
                  style={styles.amountInput}
                  value={amountText}
                  onChangeText={setAmountText}
                  keyboardType="numbers-and-punctuation"
                  autoFocus={!initial}
                />
                <Text style={[styles.label, styles.unitText]}>{unitText}</Text>
              </View>
              <Text style={styles.secondaryText}>(Enter a number or fraction)</Text>
            </>
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
    justifyContent: 'space-between',
    gap: 2,
    width: '100%',
  },
  label: {
    fontSize: 18,
    color: colors.text,
  },
  amountLabel: {
    flex: 1,
  },
  amountInput: {
    width: 78,
    fontSize: 18,
    padding: 8,
    textAlign: 'right',
    color: colors.text,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.separator,
    borderRadius: 8,
  },
  unitText: {
    width: 20,
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
