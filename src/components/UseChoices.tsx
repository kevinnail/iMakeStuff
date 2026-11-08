import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Chevron } from '@/components/Chevron';
import {
  UsePanel,
  useLabels,
  type AvailableItem,
  type NewPrepHandlers,
  type UseChoice,
  type UseKind,
} from '@/components/UsePanel';
import type { PieceCategory } from '@/db/queries/pieceQueries';
import type { TemplateUse } from '@/db/queries/prepQueries';
import { colors } from '@/theme';
import { formatAmount } from '@/utils/prepTime';

// A template's prep or supply with nothing to add for it, shown so it's clear nothing was added: a
// by eye one all used or lost with nothing open of its kind, or a counted prep whose template is
// lost or is no longer a template.
export interface MissingUse {
  batchId: number;
  name: string;
  reason: 'All used' | 'Lost' | 'Not a template';
}

interface UseChoicesProps {
  kind: UseKind;
  // The piece or prep these are used on.
  usedBy: PieceCategory;
  availableItems: AvailableItem[];
  chosen: UseChoice[];
  // A template's lines with nothing to add for them.
  missing: MissingUse[];
  onChange: (chosen: UseChoice[]) => void;
  // A prep or supply saved from the empty list. New prep is saved with its own work time, which
  // the form's times may now overlap.
  onItemAdded?: () => void;
  // A prep list's New prep panel, passed on to the use panel.
  renderNewPrep?: (handlers: NewPrepHandlers) => ReactNode;
  // Sets the card's color where it sits on a panel the color of the page's cards.
  style?: StyleProp<ViewStyle>;
}

// A template's prep or supplies as a form starts with them: what's already saved on the piece,
// then each template line with a batch available, filled in at the template's amount (the newest
// open one of its kind swapped in where the template's own is closed), and the rest as missing
// lines. A line of a kind already saved is left out by getTemplateUses.
export function getTemplateChoices(uses: TemplateUse<AvailableItem>[], saved: UseChoice[] = []) {
  const chosen = uses.flatMap(
    ({ batch_id, share_numerator, share_denominator, replacement }): UseChoice[] =>
      replacement
        ? [
            {
              item: {
                id: replacement.id,
                name: replacement.name,
                otherUsesShare: replacement.used_share,
                size_amount: replacement.size_amount,
                size_unit: replacement.size_unit,
              },
              share: { share_numerator, share_denominator },
              ...(replacement.id === batch_id ? {} : { note: 'Newer batch' }),
            },
          ]
        : [],
  );
  const missing = uses
    .filter((use) => !use.replacement)
    .map((use): MissingUse => ({
      batchId: use.batch_id,
      name: use.batch_name,
      reason: use.batch_lost ? 'Lost' : use.counted ? 'Not a template' : 'All used',
    }));
  return { chosen: [...saved, ...chosen], missing };
}

// Prep or supplies used on a piece: the heading, then the list as one card. Each chosen one is
// a row with its share, tapped to change or remove it. A template prep that's gone is a row
// saying so, with nothing added for it, and isn't saved. The last row adds one. Nothing is
// saved until the form it's in is.
export function UseChoices({
  kind,
  usedBy,
  availableItems,
  chosen,
  missing,
  onChange,
  onItemAdded,
  renderNewPrep,
  style,
}: UseChoicesProps) {
  const labels = useLabels[kind];
  const [picking, setPicking] = useState(false);
  const [changing, setChanging] = useState<UseChoice | null>(null);
  // Prep and supplies added from the empty list, and every batch as it was last repriced, which
  // only replaces one already in the list.
  const [addedItems, setAddedItems] = useState<AvailableItem[]>([]);
  const [repricedItems, setRepricedItems] = useState<AvailableItem[]>([]);
  const items = [...availableItems, ...addedItems].map(
    (item) => repricedItems.find((repriced) => repriced.id === item.id) ?? item,
  );
  const unchosenItems = items.filter(
    (item) => !chosen.some((choice) => choice.item.id === item.id),
  );
  const isEmpty = chosen.length === 0 && missing.length === 0;

  function add(choice: UseChoice) {
    onChange([...chosen, choice]);
    setPicking(false);
  }

  // Keeps the line's note and saved use, since only the share changes.
  function change({ item, share }: UseChoice) {
    onChange(chosen.map((choice) => (choice.item.id === item.id ? { ...choice, share } : choice)));
    setChanging(null);
  }

  function keepAdded(item: AvailableItem) {
    setAddedItems([...addedItems, item]);
    onItemAdded?.();
  }

  function remove(itemId: number) {
    onChange(chosen.filter((choice) => choice.item.id !== itemId));
    setChanging(null);
  }

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>{labels.heading}</Text>
      <View style={[styles.card, style]}>
        {isEmpty && (
          <View style={styles.row}>
            <Text style={styles.secondaryText}>{labels.noneAdded}</Text>
          </View>
        )}
        {chosen.map((choice, index) => (
          <Pressable
            key={choice.item.id}
            style={({ pressed }) => [
              styles.row,
              index > 0 && styles.separator,
              pressed && styles.buttonPressed,
            ]}
            onPress={() => setChanging(choice)}
          >
            <View style={styles.name}>
              <Text style={styles.text}>{choice.item.name}</Text>
              {choice.note ? <Text style={styles.note}>{choice.note}</Text> : null}
            </View>
            <Text style={styles.text}>{formatAmount(choice.share, choice.item)}</Text>
            <Chevron />
          </Pressable>
        ))}
        {missing.map((line, index) => (
          <View
            key={line.batchId}
            style={[styles.row, (chosen.length > 0 || index > 0) && styles.separator]}
          >
            <View style={styles.name}>
              <Text style={styles.text}>{line.name}</Text>
              <Text style={styles.note}>{line.reason}</Text>
            </View>
            <Text style={styles.secondaryText}>Not added</Text>
          </View>
        ))}
        <Pressable
          style={({ pressed }) => [styles.row, styles.separator, pressed && styles.buttonPressed]}
          onPress={() => setPicking(true)}
        >
          <Text style={styles.addText}>{labels.add}</Text>
        </Pressable>
      </View>
      {picking && (
        <UsePanel
          kind={kind}
          usedBy={usedBy}
          itemList={unchosenItems}
          initial={null}
          onCancel={() => setPicking(false)}
          onSave={add}
          onItemAdded={keepAdded}
          onRepriced={setRepricedItems}
          renderNewPrep={renderNewPrep}
        />
      )}
      {changing && (
        <UsePanel
          kind={kind}
          usedBy={usedBy}
          itemList={null}
          initial={changing}
          onCancel={() => setChanging(null)}
          onSave={change}
          onRemove={() => remove(changing.item.id)}
          onRepriced={setRepricedItems}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 8,
  },
  heading: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
  },
  card: {
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  separator: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  name: {
    flex: 1,
  },
  buttonPressed: {
    opacity: 0.6,
  },
  text: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.text,
  },
  secondaryText: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.secondaryText,
  },
  addText: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.primary,
  },
  note: {
    fontSize: 16,
    color: colors.secondaryText,
  },
});
