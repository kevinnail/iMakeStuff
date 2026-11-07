import { useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Chevron } from '@/components/Chevron';
import {
  UsePanel,
  useLabels,
  type AvailableItem,
  type UseChoice,
  type UseKind,
} from '@/components/UsePanel';
import type { PieceCategory } from '@/db/queries/pieceQueries';
import type { TemplatePrepUse } from '@/db/queries/prepQueries';
import { colors } from '@/theme';
import { formatShare, getShareValue, isPastWhole } from '@/utils/prepTime';

// A template's prep that's all used or lost with no newer batch, shown so it's clear nothing was added for it.
export interface MissingPrep {
  prepId: number;
  name: string;
  reason: 'All used' | 'Lost';
}

interface UseChoicesProps {
  kind: UseKind;
  // The piece or prep these are used on.
  usedBy: PieceCategory;
  availableItems: AvailableItem[];
  chosen: UseChoice[];
  // A template's prep with nothing to add for it. Supplies have none.
  missing?: MissingPrep[];
  onChange: (chosen: UseChoice[]) => void;
  // Sets the card's color where it sits on a panel the color of the page's cards.
  style?: StyleProp<ViewStyle>;
}

// A template's prep as a form starts with it: each one with a batch available, filled in at the
// template's amount (a newer batch swapped in where the template's own is gone), and the rest
// as missing lines.
export function getTemplateChoices(uses: TemplatePrepUse[]) {
  const chosen = uses.flatMap(
    ({ prep_id, share_numerator, share_denominator, replacement }): UseChoice[] =>
      replacement
        ? [
            {
              item: {
                id: replacement.id,
                name: replacement.name,
                otherUsesShare: replacement.used_share,
                usedUp: false,
              },
              share: { share_numerator, share_denominator },
              fromTemplate: true,
              ...(replacement.id === prep_id ? {} : { note: 'Newer batch' }),
            },
          ]
        : [],
  );
  const missing = uses
    .filter((use) => !use.replacement)
    .map((use): MissingPrep => ({
      prepId: use.prep_id,
      name: use.prep_name,
      reason: use.prep_lost ? 'Lost' : 'All used',
    }));
  return { chosen, missing };
}

// A template's amount hasn't been through the prep panel, which asks before a use goes past 100%,
// so the form's Save asks instead when one would.
export function confirmTemplateUseUp(chosen: UseChoice[], save: () => void) {
  const usingUp = chosen.filter(
    ({ item, share, fromTemplate }) =>
      fromTemplate && isPastWhole(item.otherUsesShare + getShareValue(share)),
  );
  if (usingUp.length === 0) {
    save();
    return;
  }
  Alert.alert(
    `All of ${usingUp.map(({ item }) => item.name).join(' and ')} used?`,
    "The template's amount brings it past 100%, so saving marks it all used and scales every share to add up to 100%.",
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'All used', onPress: save },
    ],
  );
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
  missing = [],
  onChange,
  style,
}: UseChoicesProps) {
  const labels = useLabels[kind];
  const [picking, setPicking] = useState(false);
  const [changing, setChanging] = useState<UseChoice | null>(null);
  // Supplies added from the empty list after the form loaded.
  const [addedItems, setAddedItems] = useState<AvailableItem[]>([]);
  const unchosenItems = [...availableItems, ...addedItems].filter(
    (item) => !chosen.some((choice) => choice.item.id === item.id),
  );
  const isEmpty = chosen.length === 0 && missing.length === 0;

  function add(choice: UseChoice) {
    onChange([...chosen, choice]);
    setPicking(false);
  }

  // Keeps the line's note and saved use, since only the share changes. The panel has asked
  // about using it up, so it's no longer the template's amount.
  function change({ item, share }: UseChoice) {
    onChange(
      chosen.map((choice) =>
        choice.item.id === item.id ? { ...choice, share, fromTemplate: false } : choice,
      ),
    );
    setChanging(null);
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
            <Text style={styles.text}>{formatShare(choice.share)}</Text>
            <Chevron />
          </Pressable>
        ))}
        {missing.map((line, index) => (
          <View
            key={line.prepId}
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
          onItemAdded={(item) => setAddedItems([...addedItems, item])}
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
