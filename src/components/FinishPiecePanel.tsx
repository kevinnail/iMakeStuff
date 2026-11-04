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

import { PrepPickerPanel } from '@/components/PrepPickerPanel';
import { askPrepPercent } from '@/components/prepUsePrompts';
import type { AvailablePrep, NewPrepUse } from '@/db/queries/prepQueries';
import { colors } from '@/theme';

interface ChosenPrep {
  prep: AvailablePrep;
  estimatedPercent: number;
}

interface FinishPiecePanelProps {
  pieceName: string;
  cameraPhotoUri: string | null;
  // null when finishing prep, which doesn't use other prep.
  availablePrep: AvailablePrep[] | null;
  onCancel: () => void;
  onSave: (notes: string | null, prepUses: NewPrepUse[]) => Promise<void>;
}

// Slides up after the camera. Without a photo the notes are required, so a finished
// piece can always be identified later.
export function FinishPiecePanel({
  pieceName,
  cameraPhotoUri,
  availablePrep,
  onCancel,
  onSave,
}: FinishPiecePanelProps) {
  const insets = useSafeAreaInsets();
  const [notes, setNotes] = useState('');
  const [chosenPrep, setChosenPrep] = useState<ChosenPrep[]>([]);
  const [pickingPrep, setPickingPrep] = useState(false);
  const [saving, setSaving] = useState(false);
  const trimmedNotes = notes.trim();
  const canSave = !saving && (cameraPhotoUri !== null || trimmedNotes !== '');
  const unchosenPrep = (availablePrep ?? []).filter(
    (prep) => !chosenPrep.some((chosen) => chosen.prep.id === prep.id),
  );

  function addPrep(prep: AvailablePrep, estimatedPercent: number) {
    setChosenPrep((current) => [...current, { prep, estimatedPercent }]);
    setPickingPrep(false);
  }

  function changePrep({ prep, estimatedPercent }: ChosenPrep) {
    askPrepPercent({
      prepName: prep.name,
      currentPercent: estimatedPercent,
      onSave: (newPercent) =>
        setChosenPrep((current) =>
          current.map((chosen) =>
            chosen.prep.id === prep.id ? { prep, estimatedPercent: newPercent } : chosen,
          ),
        ),
      onRemove: () =>
        setChosenPrep((current) => current.filter((chosen) => chosen.prep.id !== prep.id)),
    });
  }

  function handleSave() {
    setSaving(true);
    const prepUses = chosenPrep.map(({ prep, estimatedPercent }) => ({
      prepId: prep.id,
      estimatedPercent,
    }));
    onSave(trimmedNotes || null, prepUses).catch((error: Error) => {
      setSaving(false);
      Alert.alert('Could not save', error.message);
    });
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
      <KeyboardAvoidingView style={styles.overlay} behavior="padding">
        <View style={[styles.panel, { paddingBottom: insets.bottom + 16 }]}>
          <Text style={styles.pieceName}>{pieceName}</Text>
          {cameraPhotoUri && <Image source={{ uri: cameraPhotoUri }} style={styles.photo} />}
          <TextInput
            style={styles.notesInput}
            value={notes}
            onChangeText={setNotes}
            placeholder={cameraPhotoUri ? 'Notes' : 'No photo: describe the piece.'}
            placeholderTextColor={colors.secondaryText}
            multiline
            autoFocus={!cameraPhotoUri}
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
                  style={styles.prepRow}
                  onPress={() => changePrep(chosen)}
                >
                  <Text style={styles.prepText}>{chosen.prep.name}</Text>
                  <Text style={styles.prepText}>{chosen.estimatedPercent}%</Text>
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
        <PrepPickerPanel
          prepList={unchosenPrep}
          onCancel={() => setPickingPrep(false)}
          onAdd={addPrep}
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
