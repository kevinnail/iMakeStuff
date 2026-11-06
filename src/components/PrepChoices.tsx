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
import { PrepUsePanel, type PrepUseChoice } from '@/components/PrepUsePanel';
import type { AvailablePrep, TemplatePrepUse } from '@/db/queries/prepQueries';
import { colors } from '@/theme';
import { formatShare, getShareValue, usesUpPrep } from '@/utils/prepTime';

// A template's prep that's used up or lost with no newer batch, shown so it's clear nothing was added for it.
export interface MissingPrep {
  prepId: number;
  name: string;
  reason: 'Used up' | 'Lost';
}

interface PrepChoicesProps {
  availablePrep: AvailablePrep[];
  chosen: PrepUseChoice[];
  missing: MissingPrep[];
  onChange: (chosen: PrepUseChoice[]) => void;
  // Sets the card's color where it sits on a panel the color of the page's cards.
  style?: StyleProp<ViewStyle>;
}

// A template's prep as a form starts with it: each one with a batch available, filled in at the
// template's amount (a newer batch swapped in where the template's own is gone), and the rest
// as missing lines.
export function getTemplateChoices(uses: TemplatePrepUse[]) {
  const chosen = uses.flatMap(
    ({ prep_id, share_numerator, share_denominator, replacement }): PrepUseChoice[] =>
      replacement
        ? [
            {
              prep: {
                id: replacement.id,
                name: replacement.name,
                otherPiecesShare: replacement.used_share,
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
      reason: use.prep_lost ? 'Lost' : 'Used up',
    }));
  return { chosen, missing };
}

// A template's amount hasn't been through the prep panel, which asks before a use reaches 100%,
// so the form's Save asks instead when one would use its prep up.
export function confirmTemplateUseUp(chosen: PrepUseChoice[], save: () => void) {
  const usingUp = chosen.filter(
    ({ prep, share, fromTemplate }) =>
      fromTemplate && usesUpPrep(prep.otherPiecesShare + getShareValue(share)),
  );
  if (usingUp.length === 0) {
    save();
    return;
  }
  Alert.alert(
    `Use up ${usingUp.map(({ prep }) => prep.name).join(' and ')}?`,
    "The template's amount brings it to 100% or more, so saving marks it used up.",
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Mark used up', onPress: save },
    ],
  );
}

// Prep used on a piece: the heading, then the list as one card. Each chosen prep is a row with its
// share, tapped to change or remove it. A template prep that's gone is a row saying so, with
// nothing added for it, and isn't saved. The last row adds prep. Nothing is saved until the
// form it's in is.
export function PrepChoices({ availablePrep, chosen, missing, onChange, style }: PrepChoicesProps) {
  const [pickingPrep, setPickingPrep] = useState(false);
  const [changingPrep, setChangingPrep] = useState<PrepUseChoice | null>(null);
  const unchosenPrep = availablePrep.filter(
    (prep) => !chosen.some((choice) => choice.prep.id === prep.id),
  );
  const isEmpty = chosen.length === 0 && missing.length === 0;

  function addPrep(choice: PrepUseChoice) {
    onChange([...chosen, choice]);
    setPickingPrep(false);
  }

  // Keeps the line's note and saved use, since only the share changes. The panel has asked
  // about using it up, so it's no longer the template's amount.
  function changePrep({ prep, share }: PrepUseChoice) {
    onChange(
      chosen.map((choice) =>
        choice.prep.id === prep.id ? { ...choice, share, fromTemplate: false } : choice,
      ),
    );
    setChangingPrep(null);
  }

  function removePrep(prepId: number) {
    onChange(chosen.filter((choice) => choice.prep.id !== prepId));
    setChangingPrep(null);
  }

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>Prep used</Text>
      <View style={[styles.card, style]}>
        {isEmpty && (
          <View style={styles.row}>
            <Text style={styles.secondaryText}>No prep added</Text>
          </View>
        )}
        {chosen.map((choice, index) => (
          <Pressable
            key={choice.prep.id}
            style={({ pressed }) => [
              styles.row,
              index > 0 && styles.separator,
              pressed && styles.buttonPressed,
            ]}
            onPress={() => setChangingPrep(choice)}
          >
            <View style={styles.name}>
              <Text style={styles.text}>{choice.prep.name}</Text>
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
          onPress={() => setPickingPrep(true)}
        >
          <Text style={styles.addText}>Add prep</Text>
        </Pressable>
      </View>
      {pickingPrep && (
        <PrepUsePanel
          prepList={unchosenPrep}
          initial={null}
          onCancel={() => setPickingPrep(false)}
          onSave={addPrep}
        />
      )}
      {changingPrep && (
        <PrepUsePanel
          prepList={null}
          initial={changingPrep}
          onCancel={() => setChangingPrep(null)}
          onSave={changePrep}
          onRemove={() => removePrep(changingPrep.prep.id)}
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
