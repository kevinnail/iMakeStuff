import { useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Chevron } from '@/components/Chevron';
import { JoinedButtons } from '@/components/JoinedButtons';
import { PrepUsePanel, type PrepUseChoice } from '@/components/PrepUsePanel';
import type { AvailablePrep, NewPrepUse } from '@/db/queries/prepQueries';
import { colors } from '@/theme';

interface FinishPiecePanelProps {
  pieceName: string;
  photoUri: string | null;
  // null when finishing prep, which doesn't use other prep.
  availablePrep: AvailablePrep[] | null;
  onCancel: () => void;
  onSave: (notes: string | null, lost: boolean, prepUses: NewPrepUse[]) => Promise<void>;
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
  onCancel,
  onSave,
}: FinishPiecePanelProps) {
  const insets = useSafeAreaInsets();
  const [outcome, setOutcome] = useState<Outcome>('good');
  const [notes, setNotes] = useState('');
  const [chosenPrep, setChosenPrep] = useState<PrepUseChoice[]>([]);
  const [pickingPrep, setPickingPrep] = useState(false);
  const [changingPrep, setChangingPrep] = useState<PrepUseChoice | null>(null);
  const [saving, setSaving] = useState(false);
  const trimmedNotes = notes.trim();
  const canSave = !saving && (photoUri !== null || trimmedNotes !== '');
  const unchosenPrep = (availablePrep ?? []).filter(
    (prep) => !chosenPrep.some((chosen) => chosen.prep.id === prep.id),
  );

  function addPrep(choice: PrepUseChoice) {
    setChosenPrep((current) => [...current, choice]);
    setPickingPrep(false);
  }

  function changePrep(choice: PrepUseChoice) {
    setChosenPrep((current) =>
      current.map((chosen) => (chosen.prep.id === choice.prep.id ? choice : chosen)),
    );
    setChangingPrep(null);
  }

  function removePrep(prepId: number) {
    setChosenPrep((current) => current.filter((chosen) => chosen.prep.id !== prepId));
    setChangingPrep(null);
  }

  function handleSave() {
    setSaving(true);
    const prepUses = chosenPrep.map(({ prep, estimatedPercent }) => ({
      prepId: prep.id,
      estimatedPercent,
    }));
    onSave(trimmedNotes || null, outcome === 'lost', prepUses).catch((error: Error) => {
      setSaving(false);
      Alert.alert('Could not save', error.message);
    });
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
      <KeyboardAvoidingView style={styles.overlay} behavior="padding">
        <View style={[styles.panel, { paddingBottom: insets.bottom + 16 }]}>
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
            autoFocus={!photoUri}
          />
          {availablePrep && availablePrep.length > 0 && (
            <View style={styles.prepSection}>
              <View style={styles.prepRow}>
                <Text style={styles.prepTitle}>Prep used</Text>
                <Pressable
                  style={({ pressed }) => [styles.addPrepButton, pressed && styles.buttonPressed]}
                  onPress={() => setPickingPrep(true)}
                >
                  <Text style={styles.prepText}>Add prep</Text>
                </Pressable>
              </View>
              {chosenPrep.map((chosen) => (
                <Pressable
                  key={chosen.prep.id}
                  style={({ pressed }) => [styles.prepRow, pressed && styles.buttonPressed]}
                  onPress={() => setChangingPrep(chosen)}
                >
                  <Text style={[styles.prepText, styles.prepName]}>{chosen.prep.name}</Text>
                  <Text style={styles.prepText}>{chosen.estimatedPercent}%</Text>
                  <Chevron />
                </Pressable>
              ))}
            </View>
          )}
          <View style={styles.buttonRow}>
            <Pressable style={styles.cancelButton} onPress={onCancel}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.saveButton, !canSave && styles.buttonDisabled]}
              onPress={handleSave}
              disabled={!canSave}
            >
              <Text style={styles.saveButtonText}>Save</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
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
    padding: 16,
    gap: 12,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    backgroundColor: colors.surface,
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
  prepSection: {
    gap: 8,
  },
  prepRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  prepTitle: {
    fontSize: 18,
    color: colors.secondaryText,
  },
  prepName: {
    flex: 1,
  },
  addPrepButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 8,
  },
  buttonPressed: {
    opacity: 0.6,
  },
  prepText: {
    fontSize: 18,
    lineHeight: 20,
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
