import { useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { JoinedButtons } from '@/components/JoinedButtons';
import { confirmTemplateUseUp, UseChoices, type MissingPrep } from '@/components/UseChoices';
import type { AvailableItem, UseChoice } from '@/components/UsePanel';
import type { FinishPrepUse } from '@/db/queries/prepQueries';
import type { FinishSupplyUse } from '@/db/queries/supplyQueries';
import { colors } from '@/theme';

interface FinishPiecePanelProps {
  pieceName: string;
  photoUri: string | null;
  // null when finishing prep, which doesn't use other prep.
  availablePrep: AvailableItem[] | null;

  initialPrep: UseChoice[];
  missingPrep: MissingPrep[];
  availableSupplies: AvailableItem[];
  initialSupplies: UseChoice[];
  onCancel: () => void;
  onSave: (
    notes: string | null,
    lost: boolean,
    prepUses: FinishPrepUse[],
    supplyUses: FinishSupplyUse[],
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
  onCancel,
  onSave,
}: FinishPiecePanelProps) {
  const [outcome, setOutcome] = useState<Outcome>('good');
  const [notes, setNotes] = useState('');
  const [chosenPrep, setChosenPrep] = useState(initialPrep);
  const [chosenSupplies, setChosenSupplies] = useState(initialSupplies);
  const [saving, setSaving] = useState(false);
  const trimmedNotes = notes.trim();
  const canSave = !saving && (photoUri !== null || trimmedNotes !== '');

  function save() {
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
    onSave(trimmedNotes || null, outcome === 'lost', prepUses, supplyUses).catch((error: Error) => {
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
            <UseChoices
              kind="supply"
              usedBy={availablePrep ? 'piece' : 'prep'}
              availableItems={availableSupplies}
              chosen={chosenSupplies}
              onChange={setChosenSupplies}
              style={styles.useCard}
            />
          </ScrollView>
          <View style={styles.buttonRow}>
            <Pressable style={styles.cancelButton} onPress={onCancel}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.saveButton, !canSave && styles.buttonDisabled]}
              onPress={() => confirmTemplateUseUp(chosenPrep, save)}
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
