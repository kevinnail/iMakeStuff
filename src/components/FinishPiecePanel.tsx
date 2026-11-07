import { useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  getCountTexts,
  getPrepKind,
  noCount,
  PrepKindField,
  prepCountError,
  readPrepCount,
} from '@/components/CountField';
import { JoinedButtons } from '@/components/JoinedButtons';
import { UseChoices, type MissingPrep } from '@/components/UseChoices';
import type { AvailableItem, UseChoice } from '@/components/UsePanel';
import type { FinishPrepUse } from '@/db/queries/prepQueries';
import type { FinishSupplyUse } from '@/db/queries/supplyQueries';
import { colors } from '@/theme';
import { defaultsToTemplate, type BatchSize, type SizeInput } from '@/utils/prepTime';

interface FinishPiecePanelProps {
  pieceName: string;
  photoUri: string | null;
  // null when finishing prep, which doesn't use other prep.
  availablePrep: AvailableItem[] | null;

  initialPrep: UseChoice[];
  missingPrep: MissingPrep[];
  availableSupplies: AvailableItem[];
  initialSupplies: UseChoice[];
  // Prep's count so far, from its template if it has one.
  initialSize: BatchSize;
  // A batch of a counted prep's template: the template knows its count and supplies, so Done
  // asks only for a photo or notes.
  laterBatch: boolean;
  // Started from a template, so Save as template isn't offered.
  fromTemplate: boolean;
  onCancel: () => void;
  onSave: (
    notes: string | null,
    lost: boolean,
    isTemplate: boolean,
    prepUses: FinishPrepUse[],
    supplyUses: FinishSupplyUse[],
    size: SizeInput,
  ) => Promise<void>;
}

export type Outcome = 'good' | 'lost';

export const outcomeOptions: { value: Outcome; label: string }[] = [
  { value: 'good', label: 'Good' },
  { value: 'lost', label: 'Lost' },
];

export function getNotesPlaceholder(lost: boolean, hasPhoto: boolean) {
  if (lost) return hasPhoto ? 'What happened?' : 'No photo: what happened?';
  return hasPhoto ? 'Notes' : 'No photo: describe the piece.';
}

// Slides up after the camera. Without a photo the notes are required, so a finished
// piece can always be identified later.
export function FinishPiecePanel({
  pieceName,
  photoUri,
  availablePrep,
  initialPrep,
  missingPrep,
  availableSupplies,
  initialSupplies,
  initialSize,
  laterBatch,
  fromTemplate,
  onCancel,
  onSave,
}: FinishPiecePanelProps) {
  const [outcome, setOutcome] = useState<Outcome>('good');
  const [notes, setNotes] = useState('');
  const [chosenPrep, setChosenPrep] = useState(initialPrep);
  const [chosenSupplies, setChosenSupplies] = useState(initialSupplies);
  const [prepKind, setPrepKind] = useState(() => getPrepKind(initialSize));
  const [countTexts, setCountTexts] = useState(() => getCountTexts(initialSize));
  // null until the switch is tapped.
  const [templateChoice, setTemplateChoice] = useState<boolean | null>(null);
  const finishingPrep = availablePrep === null;
  const saveAsTemplate =
    templateChoice ??
    defaultsToTemplate(finishingPrep && prepKind === 'counted', outcome === 'lost');
  const [saving, setSaving] = useState(false);
  const trimmedNotes = notes.trim();
  const canSave = !saving && (photoUri !== null || trimmedNotes !== '');

  function save() {
    const size = !finishingPrep
      ? noCount
      : laterBatch
        ? { sizeAmount: initialSize.size_amount, sizeUnit: initialSize.size_unit }
        : readPrepCount(prepKind, countTexts);
    if (size === null) {
      Alert.alert(prepCountError);
      return;
    }
    setSaving(true);
    // A use already on the piece keeps its id, so it's changed rather than added again.
    const prepUses = chosenPrep.map(({ item, share, useId }) => ({
      prepId: item.id,
      share,
      useId,
    }));
    const supplyUses = chosenSupplies.map(({ item, share, useId }) => ({
      supplyId: item.id,
      share,
      useId,
    }));
    onSave(
      trimmedNotes || null,
      outcome === 'lost',
      !fromTemplate && saveAsTemplate,
      prepUses,
      supplyUses,
      size,
    ).catch((error: Error) => {
      setSaving(false);
      Alert.alert('Could not save', error.message);
    });
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
      <KeyboardAvoidingView style={styles.overlay} behavior="padding">
        <SafeAreaView edges={{ bottom: 'additive' }} style={styles.panel}>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <JoinedButtons options={outcomeOptions} selected={outcome} onSelect={setOutcome} />
            <Text style={styles.pieceName}>{pieceName}</Text>
            {photoUri && <Image source={{ uri: photoUri }} style={styles.photo} />}

            <TextInput
              style={styles.notesInput}
              value={notes}
              onChangeText={setNotes}
              placeholder={getNotesPlaceholder(outcome === 'lost', photoUri !== null)}
              placeholderTextColor={colors.secondaryText}
              multiline
              returnKeyType="done"
              submitBehavior="blurAndSubmit"
              autoFocus={!photoUri}
            />
            {availablePrep && (
              <UseChoices
                kind="prep"
                usedBy="piece"
                availableItems={availablePrep}
                chosen={chosenPrep}
                missing={missingPrep}
                onChange={setChosenPrep}
                style={styles.useCard}
              />
            )}
            {finishingPrep && !laterBatch && (
              <PrepKindField
                kind={prepKind}
                onChangeKind={setPrepKind}
                texts={countTexts}
                onChangeTexts={setCountTexts}
              />
            )}
            {!laterBatch && (
              <UseChoices
                kind="supply"
                usedBy={availablePrep ? 'piece' : 'prep'}
                availableItems={availableSupplies}
                chosen={chosenSupplies}
                onChange={setChosenSupplies}
                style={styles.useCard}
              />
            )}
          </ScrollView>
          {/* In the footer with Save, so it's never scrolled out of sight. */}
          {!fromTemplate && (
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Save as template</Text>
              <Switch
                value={saveAsTemplate}
                onValueChange={setTemplateChoice}
                trackColor={{ true: colors.primary }}
              />
            </View>
          )}
          <View style={styles.buttonRow}>
            <Pressable style={styles.cancelButton} onPress={onCancel}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.saveButton, !canSave && styles.buttonDisabled]}
              onPress={save}
              disabled={!canSave}
            >
              <Text style={styles.saveButtonText}>Save</Text>
            </Pressable>
          </View>
        </SafeAreaView>
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
    maxHeight: '90%',
    padding: 16,
    gap: 12,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    backgroundColor: colors.surface,
  },
  // Shrinks to the room left above Cancel and Save, so nothing scrolls behind them.
  scroll: {
    flexShrink: 1,
  },
  content: {
    gap: 12,
  },
  pieceName: {
    fontSize: 20,
    color: colors.text,
  },
  photo: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 8,
  },
  notesInput: {
    fontSize: 18,
    padding: 12,
    height: 100,
    textAlignVertical: 'top',
    color: colors.text,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.separator,
    borderRadius: 8,
  },
  useCard: {
    backgroundColor: colors.background,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  switchLabel: {
    flex: 1,
    fontSize: 18,
    color: colors.text,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  cancelButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  cancelButtonText: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.text,
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
