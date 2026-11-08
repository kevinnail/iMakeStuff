import { useEffect, useState, type ReactNode } from 'react';
import {
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
import { FieldError, useMissingFields } from '@/components/FieldError';
import { SupplyPanel } from '@/components/SupplyPanel';
import type { PieceCategory } from '@/db/queries/pieceQueries';
import { getAvailablePrep, getPrepPrice, type PartPrice } from '@/db/queries/prepQueries';
import {
  addSupply,
  getSupplies,
  updateSupply,
  type SupplyDetails,
  type SupplyRecord,
} from '@/db/queries/supplyQueries';
import { colors } from '@/theme';
import { formatCost } from '@/utils/cost';
import { formatDay, formatDuration } from '@/utils/formatTime';
import { getUseMissing, missingMessages } from '@/utils/missingFields';
import { showError } from '@/utils/showError';
import {
  formatAmount,
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
      "Made it already? Add it here with when you made it, and it's picked for you. Next time, time it on the Work screen: pick Prep, start it, and tap Done when it's made.",
    newItem: 'New prep',
    choose: 'Choose prep',
  },
  supply: {
    heading: 'Supplies used',
    add: 'Add supply',
    noneAdded: 'No supplies added',
    noneToUse: 'No open supplies to pick from.',
    noneToUseHelp: "Add what you bought, like a tube at $15, and it's picked for you here.",
    newItem: 'Add supply',
    choose: 'Choose a supply',
  },
};

// Supplies are where every cost starts, so new prep waits for them to be set up first.
const noSuppliesHelp =
  'Prep costs what its supplies did, so add what you bought first, on the Pieces tab under Supplies. Then add the prep here.';

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

// "$3.76 and 10m": the part of a counted prep's whole cost and time, 1 being all of it.
function getPriceText(
  { cost_cents, cost_estimated, worked_milliseconds }: PartPrice,
  fraction: number,
) {
  const values = [
    ...(cost_cents === null ? [] : [formatCost(Math.round(cost_cents * fraction))]),
    formatDuration(worked_milliseconds * fraction),
  ];
  return `${values.join(' and ')}${cost_estimated ? ', estimated' : ''}`;
}

// What the New prep panel is given to close itself and hand back the prep it saved.
export interface NewPrepHandlers {
  onCancel: () => void;
  onSaved: (prep: AvailableItem) => void;
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
  // What's using it: a piece takes part of a batch, and a prep takes a whole supply.
  usedBy: PieceCategory;
  // Adding a use: the prep or supplies to choose from. Changing one: null.
  itemList: AvailableItem[] | null;
  // Changing a use: it as saved. Adding one: null.
  initial: UseChoice | null;
  onCancel: () => void;
  onSave: (choice: UseChoice) => void;
  onRemove?: () => void;
  // A prep or supply added from the empty list, and every prep after Update price, so the list
  // they came from offers them as they are now.
  onItemAdded?: (item: AvailableItem) => void;
  onRepriced?: (items: AvailableItem[]) => void;
  // A prep list's New prep panel. The screen passes it in rather than this file importing it,
  // since New prep has a supply list of its own that opens this panel.
  renderNewPrep?: (handlers: NewPrepHandlers) => ReactNode;
}

// Slides up from the bottom to add a use of a prep or supply, or change one: which one, and how
// much of it the piece took. A prep takes the whole supply it picks, so picking adds it. With
// nothing to pick, it says why and how to fix it, and a prep or supply can be added right here,
// on its own panel over this one, without leaving the form underneath. A counted
// prep not saved on the piece yet shows what the amount typed costs, its price per part, and the
// supplies that price comes from, each with Update price.
export function UsePanel({
  kind,
  usedBy,
  itemList,
  initial,
  onCancel,
  onSave,
  onRemove,
  onItemAdded,
  onRepriced,
  renderNewPrep,
}: UsePanelProps) {
  const labels = useLabels[kind];
  const [items, setItems] = useState(itemList);
  const [chosenItem, setChosenItem] = useState(initial?.item ?? null);
  const [amountText, setAmountText] = useState(
    initial ? getAmountText(initial.share, initial.item.size_amount) : '',
  );
  const [addingItem, setAddingItem] = useState(false);
  const [price, setPrice] = useState<PartPrice | null>(null);
  const [repricing, setRepricing] = useState<SupplyRecord | null>(null);
  // Whether any supply is saved, checked for an empty prep list. null until it's loaded.
  const [hasSupplies, setHasSupplies] = useState<boolean | null>(null);
  const emptyList = items !== null && items.length === 0;
  const canAddNew = kind === 'supply' || hasSupplies === true;
  // An empty prep list's help waits for the supplies check, since it depends on it.
  const emptyHelp =
    kind === 'supply' || hasSupplies === true
      ? labels.noneToUseHelp
      : hasSupplies === false
        ? noSuppliesHelp
        : null;
  const sizeAmount = chosenItem?.size_amount ?? null;
  const sizeUnit = chosenItem?.size_unit ?? null;
  const takesWhole = usedBy === 'prep';
  // A saved use keeps the price it was saved with, so only a new one shows today's.
  const pricedId =
    chosenItem !== null && sizeAmount !== null && initial?.useId === undefined
      ? chosenItem.id
      : null;
  const typedPercent = amountText.includes('%');
  const typedShare = parseAmount(amountText, sizeAmount);
  const typedPrice =
    chosenItem !== null && price !== null && typedShare !== null
      ? `${formatAmount(typedShare, chosenItem)}: ${getPriceText(price, getShareValue(typedShare))}`
      : null;

  useEffect(() => {
    if (kind !== 'prep' || !emptyList) return;
    getSupplies()
      .then((supplies) => setHasSupplies(supplies.length > 0))
      .catch(showError('Could not load your supplies'));
  }, [kind, emptyList]);

  useEffect(() => {
    if (pricedId === null) return;
    getPrepPrice(pricedId).then(setPrice).catch(showError('Could not load the price'));
  }, [pricedId]);

  // After the box: a counted batch's unit, or % for a bare number on a by eye batch.
  const unitText =
    sizeUnit !== null && !typedPercent
      ? sizeUnit
      : amountText !== '' && !/[/%]/.test(amountText)
        ? '%'
        : '';
  const unitHelp = `In ${sizeUnit}, like 1, 1/3, or 1 1/2.`;
  const missingFields = useMissingFields(
    getUseMissing(chosenItem !== null, amountText, sizeAmount),
  );
  const amountMissing = missingFields.shown.includes('amount');

  function choose(item: AvailableItem) {
    const choiceItem = {
      id: item.id,
      name: item.name,
      otherUsesShare: item.used_share,
      size_amount: item.size_amount,
      size_unit: item.size_unit,
    };
    if (takesWhole) {
      onSave({ item: choiceItem, share: { share_numerator: 1, share_denominator: 1 } });
      return;
    }
    // Picking the same batch again keeps its price, since it isn't loaded again.
    if (item.id !== chosenItem?.id) setPrice(null);
    setChosenItem(choiceItem);
    setAmountText('');
  }

  function handleSave() {
    if (!missingFields.check()) return;
    onSave({ item: chosenItem!, share: typedShare! });
  }

  // A new prep or supply is saved now, whatever happens to this piece, and picked in the list.
  function keepNewItem(item: AvailableItem) {
    setItems([...(items ?? []), item]);
    setAddingItem(false);
    onItemAdded?.(item);
    choose(item);
  }

  async function saveNewSupply(details: SupplyDetails, sameAsId: number | null) {
    const id = await addSupply(details, sameAsId);
    keepNewItem({
      id,
      name: details.name,
      used_share: 0,
      size_amount: null,
      size_unit: null,
      cost_cents: details.costCents,
    });
  }

  // The new price goes on everything priced from that supply, here and in the form's list.
  async function savePrice(supplyId: number, details: SupplyDetails) {
    await updateSupply(supplyId, details);
    const [fresh, newPrice] = await Promise.all([getAvailablePrep(null), getPrepPrice(pricedId!)]);
    setItems(items && items.map((item) => fresh.find(({ id }) => id === item.id) ?? item));
    setPrice(newPrice);
    setRepricing(null);
    onRepriced?.(fresh);
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
      <KeyboardAvoidingView style={styles.overlay} behavior="padding">
        {/* Measures its own place on screen: the Work tab's inset counts the tab bar, which
            this panel covers. */}
        <SafeAreaView edges={{ bottom: 'additive' }} style={styles.panel}>
          <Text style={styles.title}>{initial ? initial.item.name : labels.add}</Text>
          {emptyList && (
            <>
              <Text style={styles.label}>{labels.noneToUse}</Text>
              {emptyHelp && <Text style={styles.secondaryText}>{emptyHelp}</Text>}
              {canAddNew && (
                <Pressable
                  style={({ pressed }) => [styles.addButton, pressed && styles.buttonPressed]}
                  onPress={() => setAddingItem(true)}
                >
                  <Text style={styles.saveButtonText}>{labels.newItem}</Text>
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
          {missingFields.shown.includes('item') && <FieldError message={missingMessages.item} />}
          {chosenItem && !takesWhole && (
            <>
              <View style={styles.fieldRow}>
                <Text style={[styles.label, styles.amountLabel]}>
                  {sizeUnit !== null
                    ? `How many ${sizeUnit} this piece used`
                    : 'How much this piece took'}
                </Text>
                <TextInput
                  style={[styles.amountInput, amountMissing && styles.missingInput]}
                  value={amountText}
                  onChangeText={setAmountText}
                  keyboardType="numbers-and-punctuation"
                  autoFocus={!initial}
                />
                <Text style={[styles.label, styles.unitText]}>{unitText}</Text>
              </View>
              {amountMissing ? (
                <FieldError
                  message={
                    sizeAmount === null
                      ? 'Enter a percent from 1 to 100, or a fraction like 1/8.'
                      : unitHelp
                  }
                />
              ) : (
                <Text style={styles.secondaryText}>
                  {sizeAmount === null ? '(Enter a number or fraction)' : (typedPrice ?? unitHelp)}
                </Text>
              )}
            </>
          )}
          {pricedId !== null && price && (
            <View style={styles.priceBox}>
              <Text style={styles.label}>{getPriceText(price, 1 / sizeAmount!)} each</Text>
              {price.supplies.map((supply) => (
                <View key={supply.id} style={styles.fieldRow}>
                  <Text style={[styles.secondaryText, styles.amountLabel]}>
                    {supply.name}: {formatCost(supply.cost_cents)}, priced{' '}
                    {formatDay(Date.parse(supply.priced_at))}
                  </Text>
                  <Pressable
                    style={({ pressed }) => [styles.priceButton, pressed && styles.buttonPressed]}
                    onPress={() => setRepricing(supply)}
                  >
                    <Text style={styles.priceButtonText}>Update price</Text>
                  </Pressable>
                </View>
              ))}
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
            {/* Picking adds a whole supply to a prep, and an empty list has nothing to add. */}
            {!takesWhole && items?.length !== 0 && (
              <Pressable style={styles.saveButton} onPress={handleSave}>
                <Text style={styles.saveButtonText}>{initial ? 'Save' : 'Add'}</Text>
              </Pressable>
            )}
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
      {addingItem && kind === 'supply' && (
        <SupplyPanel initial={null} onCancel={() => setAddingItem(false)} onSave={saveNewSupply} />
      )}
      {addingItem &&
        kind === 'prep' &&
        renderNewPrep?.({ onCancel: () => setAddingItem(false), onSaved: keepNewItem })}
      {repricing && (
        <SupplyPanel
          initial={repricing}
          onCancel={() => setRepricing(null)}
          onSave={(details) => savePrice(repricing.id, details)}
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
  missingInput: {
    borderColor: colors.danger,
  },
  unitText: {
    minWidth: 20,
  },
  priceBox: {
    gap: 8,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  priceButton: {
    paddingVertical: 4,
  },
  priceButtonText: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.primary,
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
  saveButtonText: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.textOnFill,
  },
});
