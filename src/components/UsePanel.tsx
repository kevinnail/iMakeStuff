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
import { SafeAreaView } from 'react-native-safe-area-context';

import { Dropdown } from '@/components/Dropdown';
import { SupplyPanel } from '@/components/SupplyPanel';
import type { PieceCategory } from '@/db/queries/pieceQueries';
import { addSupply, type SupplyDetails } from '@/db/queries/supplyQueries';
import { colors } from '@/theme';
import { formatCost } from '@/utils/cost';
import {
  formatPercent,
  formatShare,
  formatUnitAmount,
  getShareValue,
  parseAmount,
  type BatchSize,
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
    noneToUse: 'No open prep to pick from.',
    noneToUseHelp:
      "Prep shows here once it's finished. On the Work screen, pick Prep, start it, and tap Done when it's made. Prep made earlier goes in with Add Work on the Days tab.",
    choose: 'Choose prep',
  },
  supply: {
    heading: 'Supplies used',
    add: 'Add supply',
    noneAdded: 'No supplies added',
    noneToUse: 'No open supplies to pick from.',
    noneToUseHelp: "Add what you bought, like a 5 ft tube at $40, and it's picked for you here.",
    choose: 'Choose a supply',
  },
};

// A prep or supply that can be picked, with every piece's share of it added together, and its
// whole cost (null with no supply behind a prep), marked when a counted prep's holds a guess.
export interface AvailableItem extends BatchSize {
  id: number;
  name: string;
  used_share: number;
  cost_cents: number | null;
  cost_estimated?: boolean;
}

// Beside each batch in the list: how much of a by eye one is assigned, or a counted part's price.
function getPickerDetail({ used_share, size_amount, cost_cents, cost_estimated }: AvailableItem) {
  if (size_amount === null) return `${formatPercent(used_share)} assigned`;
  if (cost_cents === null) return undefined;
  const partCost = formatCost(Math.round(cost_cents / size_amount));
  return cost_estimated ? `${partCost} each, estimated` : `${partCost} each`;
}

export interface UseChoice {
  // otherUsesShare: every other piece's share of it added together, 1 being all of it.
  item: { id: number; name: string; otherUsesShare: number } & BatchSize;
  share: Share;
  note?: string;
  useId?: number;
}

// A use already saved on the piece, as a choice the panel can change or remove.
export function getSavedChoice(
  use: UseShare & { id: number },
  item: { id: number; name: string } & BatchSize,
): UseChoice {
  return {
    item: {
      ...item,
      otherUsesShare: use.shares_total - getShareValue(use),
    },
    share: { share_numerator: use.share_numerator, share_denominator: use.share_denominator },
    useId: use.id,
  };
}

function getAmountText(share: Share, sizeAmount: number | null) {
  return sizeAmount === null ? formatShare(share) : formatUnitAmount(share, sizeAmount);
}

interface UsePanelProps {
  kind: UseKind;
  // What's using it: a piece takes part of a batch, and a prep usually takes a whole supply.
  usedBy: PieceCategory;
  // Adding a use: the prep or supplies to choose from. Changing one: null.
  itemList: AvailableItem[] | null;
  // Changing a use: it as saved. Adding one: null.
  initial: UseChoice | null;
  onCancel: () => void;
  onSave: (choice: UseChoice) => void;
  onRemove?: () => void;
  // A supply added from the empty list, so the list it came from can offer it again.
  onItemAdded?: (item: AvailableItem) => void;
}

// Slides up from the bottom to add a use of a prep or supply, or change one: which one, and how
// much of it the piece or prep took. With nothing to pick, it says why and how to fix it, and a
// supply can be added right here.
export function UsePanel({
  kind,
  usedBy,
  itemList,
  initial,
  onCancel,
  onSave,
  onRemove,
  onItemAdded,
}: UsePanelProps) {
  const labels = useLabels[kind];
  const [items, setItems] = useState(itemList);
  const [chosenItem, setChosenItem] = useState(initial?.item ?? null);
  const [amountText, setAmountText] = useState(
    initial ? getAmountText(initial.share, initial.item.size_amount) : '',
  );
  const [addingSupply, setAddingSupply] = useState(false);
  const sizeAmount = chosenItem?.size_amount ?? null;
  const sizeUnit = chosenItem?.size_unit ?? null;
  const typedPercent = amountText.includes('%');
  const typedShare = parseAmount(amountText, sizeAmount);

  // After the box: a counted batch's unit, or % for a bare number on a by eye batch.
  const unitText =
    sizeUnit !== null && !typedPercent
      ? sizeUnit
      : amountText !== '' && !/[/%]/.test(amountText)
        ? '%'
        : '';
  const unitHelp = `In ${sizeUnit}, like 1, 1/3, or 1 1/2.`;
  const canSave = chosenItem !== null && amountText !== '';

  function choose(item: AvailableItem) {
    setChosenItem({
      id: item.id,
      name: item.name,
      otherUsesShare: item.used_share,
      size_amount: item.size_amount,
      size_unit: item.size_unit,
    });
    // A prep usually takes one whole supply, or one of what a counted one holds. A piece starts
    // empty.
    setAmountText(usedBy === 'piece' ? '' : item.size_amount === null ? '100' : '1');
  }

  function handleSave() {
    if (chosenItem === null) return;
    if (typedShare === null) {
      Alert.alert(
        sizeAmount === null ? 'Enter a percent from 1 to 100, or a fraction like 1/8.' : unitHelp,
      );
      return;
    }
    onSave({ item: chosenItem, share: typedShare });
  }

  // The new supply is saved now, whatever happens to this piece, and picked in the list.
  async function saveNewSupply(details: SupplyDetails) {
    const id = await addSupply(details);
    const item = {
      id,
      name: details.name,
      used_share: 0,
      size_amount: details.sizeAmount,
      size_unit: details.sizeUnit,
      cost_cents: details.costCents,
    };
    setItems([...(items ?? []), item]);
    choose(item);
    setAddingSupply(false);
    onItemAdded?.(item);
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
      <KeyboardAvoidingView style={styles.overlay} behavior="padding">
        {/* Measures its own place on screen: the Work tab's inset counts the tab bar, which
            this panel covers. */}
        <SafeAreaView edges={{ bottom: 'additive' }} style={styles.panel}>
          <Text style={styles.title}>{initial ? initial.item.name : labels.add}</Text>
          {items && items.length === 0 && (
            <>
              <Text style={styles.label}>{labels.noneToUse}</Text>
              <Text style={styles.secondaryText}>{labels.noneToUseHelp}</Text>
              {kind === 'supply' && (
                <Pressable
                  style={({ pressed }) => [styles.addButton, pressed && styles.buttonPressed]}
                  onPress={() => setAddingSupply(true)}
                >
                  <Text style={styles.saveButtonText}>Add supply</Text>
                </Pressable>
              )}
            </>
          )}
          {items && items.length > 0 && (
            <Dropdown
              options={items.map((item) => ({
                key: item.id,
                label: item.name,
                detail: getPickerDetail(item),
                item,
              }))}
              selectedKey={chosenItem?.id ?? null}
              placeholder={labels.choose}
              onSelect={({ item }) => choose(item)}
            />
          )}
          {chosenItem && (
            <>
              <View style={styles.fieldRow}>
                <Text style={[styles.label, styles.amountLabel]}>
                  {sizeUnit !== null
                    ? `How many ${sizeUnit} this ${usedBy} used`
                    : usedBy === 'prep'
                      ? 'How much of it this prep used'
                      : 'How much this piece took'}
                </Text>
                <TextInput
                  style={styles.amountInput}
                  value={amountText}
                  onChangeText={setAmountText}
                  keyboardType="numbers-and-punctuation"
                  autoFocus={!initial}
                />
                <Text style={[styles.label, styles.unitText]}>{unitText}</Text>
              </View>
              <Text style={styles.secondaryText}>
                {sizeAmount === null ? '(Enter a number or fraction)' : unitHelp}
              </Text>
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
        </SafeAreaView>
      </KeyboardAvoidingView>
      {addingSupply && (
        <SupplyPanel
          initial={null}
          onCancel={() => setAddingSupply(false)}
          onSave={saveNewSupply}
        />
      )}
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
    minWidth: 20,
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
  addButton: {
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  buttonPressed: {
    opacity: 0.6,
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
