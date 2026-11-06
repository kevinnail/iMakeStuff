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
import { colors } from '@/theme';
import {
  formatPercent,
  formatShare,
  getShareValue,
  isUsedUp,
  parseAmount,
  type Share,
  type UseShare,
} from '@/utils/prepTime';

// What a piece uses a share of: prep, or a supply.
export type UseKind = 'prep' | 'supply';

export const useLabels = {
  prep: {
    heading: 'Prep used',
    add: 'Add prep',
    noneAdded: 'No prep added',
    noneToUse: 'No finished prep to use.',
    choose: 'Choose prep',
  },
  supply: {
    heading: 'Supplies used',
    add: 'Add supply',
    noneAdded: 'No supplies added',
    noneToUse: 'No supplies to use.',
    choose: 'Choose a supply',
  },
};

// A prep or supply that can be picked, with every piece's share of it added together.
export interface AvailableItem {
  id: number;
  name: string;
  used_share: number;
}

export interface UseChoice {
  // otherUsesShare: every other piece's share of it added together, 1 being all of it.
  item: { id: number; name: string; otherUsesShare: number; usedUp: boolean };
  share: Share;
  note?: string;
  useId?: number;
  fromTemplate?: boolean;
}

// A use already saved on the piece, as a choice the panel can change or remove.
export function getSavedChoice(
  use: UseShare & { id: number },
  item: { id: number; name: string },
): UseChoice {
  return {
    item: {
      ...item,
      otherUsesShare: use.shares_total - getShareValue(use),
      usedUp: use.used_up === 1,
    },
    share: { share_numerator: use.share_numerator, share_denominator: use.share_denominator },
    useId: use.id,
  };
}

interface UsePanelProps {
  kind: UseKind;
  // Adding a use: the prep or supplies to choose from. Changing one: null.
  itemList: AvailableItem[] | null;
  // Changing a use: it as saved. Adding one: null.
  initial: UseChoice | null;
  onCancel: () => void;
  onSave: (choice: UseChoice) => void;
  onRemove?: () => void;
}

// Slides up from the bottom to add a use of a prep or supply, or change one: which one, and how
// much of it this piece took.
export function UsePanel({ kind, itemList, initial, onCancel, onSave, onRemove }: UsePanelProps) {
  const insets = useSafeAreaInsets();
  const labels = useLabels[kind];
  const [chosenItem, setChosenItem] = useState(initial?.item ?? null);
  const [amountText, setAmountText] = useState(initial ? formatShare(initial.share) : '');
  const typedShare = parseAmount(amountText);

  const unitText = amountText !== '' && !/[/%]/.test(amountText) ? '%' : '';
  const canSave = chosenItem !== null && amountText !== '';

  function handleSave() {
    if (chosenItem === null) return;
    if (typedShare === null) {
      Alert.alert('Enter a percent from 1 to 100, or a fraction like 1/8.');
      return;
    }
    const choice = { item: chosenItem, share: typedShare };
    const total = chosenItem.otherUsesShare + getShareValue(typedShare);
    if (chosenItem.usedUp || !isUsedUp(total)) {
      onSave(choice);
      return;
    }
    const totalText = formatPercent(total);
    Alert.alert(
      `Use up ${chosenItem.name}?`,
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
          <Text style={styles.title}>{initial ? initial.item.name : labels.add}</Text>
          {itemList && itemList.length === 0 && (
            <Text style={styles.secondaryText}>{labels.noneToUse}</Text>
          )}
          {itemList && itemList.length > 0 && (
            <Dropdown
              options={itemList.map((item) => ({
                key: item.id,
                label: item.name,
                detail: `${formatPercent(Math.max(0, 1 - item.used_share))} left`,
                item,
              }))}
              selectedKey={chosenItem?.id ?? null}
              placeholder={labels.choose}
              onSelect={({ item }) =>
                setChosenItem({
                  id: item.id,
                  name: item.name,
                  otherUsesShare: item.used_share,
                  usedUp: false,
                })
              }
            />
          )}
          {chosenItem && (
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
