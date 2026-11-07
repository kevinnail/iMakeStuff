import { Stack } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Chevron } from '@/components/Chevron';
import {
  getCountTexts,
  getPrepKind,
  noCount,
  PrepKindField,
  prepCountError,
  readPrepCount,
} from '@/components/CountField';
import { getNotesPlaceholder } from '@/components/FinishPiecePanel';
import { JoinedButtons } from '@/components/JoinedButtons';
import {
  deletePiece,
  updatePiece,
  type PieceCategory,
  type PieceRecord,
} from '@/db/queries/pieceQueries';
import { colors } from '@/theme';
import { formatDuration } from '@/utils/formatTime';
import { deletePhoto, getPhotoUri, showPhotoChoices, withSavedPhoto } from '@/utils/photoStorage';
import type { SizeInput } from '@/utils/prepTime';
import { showError } from '@/utils/showError';

// The saved photo, a new one to copy in, or none.
type PhotoChoice = { kind: 'saved' } | { kind: 'new'; uri: string } | { kind: 'none' };

interface PieceEditFormProps {
  piece: PieceRecord;
  worked: number;
  // For prep, how many pieces used it, for the delete confirmation.
  usedByCount: number;
  onCancel: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}

const categoryOptions: { value: PieceCategory; label: string; color?: string }[] = [
  { value: 'piece', label: 'Piece' },
  { value: 'prep', label: 'Prep', color: colors.prep },
];

export function getDeleteMessage(worked: number, usedByCount: number) {
  const workLine = `Its ${formatDuration(worked)} of work comes off the days it was worked.`;
  if (usedByCount === 0) return workLine;
  const pieces = usedByCount === 1 ? 'the piece' : `the ${usedByCount} pieces`;
  return `${workLine} It comes off ${pieces} that used it.`;
}

// The piece's page as a form, the way iOS Contacts edits a contact: Cancel and Save in the
// header, then cards like Add Work's: the name with Piece or Prep, the photo, the notes, and
// Delete piece at the bottom.
export function PieceEditForm({
  piece,
  worked,
  usedByCount,
  onCancel,
  onSaved,
  onDeleted,
}: PieceEditFormProps) {
  const [name, setName] = useState(piece.name);
  const [category, setCategory] = useState(piece.category);
  const [notes, setNotes] = useState(piece.notes ?? '');
  const [photo, setPhoto] = useState<PhotoChoice>(
    piece.photo_file_name ? { kind: 'saved' } : { kind: 'none' },
  );
  const [prepKind, setPrepKind] = useState(() => getPrepKind(piece));
  const [countTexts, setCountTexts] = useState(() => getCountTexts(piece));
  const [saving, setSaving] = useState(false);
  const trimmedName = name.trim();
  const trimmedNotes = notes.trim();
  const shownPhotoUri =
    photo.kind === 'new'
      ? photo.uri
      : photo.kind === 'saved' && piece.photo_file_name
        ? getPhotoUri(piece.photo_file_name)
        : null;
  const identifiable = !piece.finished_at || shownPhotoUri !== null || trimmedNotes !== '';
  const canSave = !saving && trimmedName !== '' && identifiable;

  function changePhoto() {
    showPhotoChoices({
      canRemove: shownPhotoUri !== null,
      onPicked: (uri) => setPhoto({ kind: 'new', uri }),
      onRemove: () => setPhoto({ kind: 'none' }),
    });
  }

  // A piece has no count, so switching to Piece drops it.
  async function save(size: SizeInput) {
    const details = { name: trimmedName, category, notes: trimmedNotes || null, ...size };
    if (photo.kind === 'new') {
      await withSavedPhoto(photo.uri, (photoFileName) =>
        updatePiece(piece.id, { ...details, photoFileName }),
      );
    } else {
      const photoFileName = photo.kind === 'saved' ? piece.photo_file_name : null;
      await updatePiece(piece.id, { ...details, photoFileName });
    }
    if (piece.photo_file_name && photo.kind !== 'saved') deletePhoto(piece.photo_file_name);
  }

  function handleSave() {
    const size = category === 'prep' ? readPrepCount(prepKind, countTexts) : noCount;
    if (size === null) {
      Alert.alert(prepCountError);
      return;
    }
    setSaving(true);
    save(size)
      .then(onSaved)
      .catch((error: Error) => {
        setSaving(false);
        Alert.alert('Could not save', error.message);
      });
  }

  function confirmDelete() {
    Alert.alert(`Delete ${piece.name}?`, getDeleteMessage(worked, usedByCount), [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          deletePiece(piece.id)
            .then((photoFileName) => {
              if (photoFileName) deletePhoto(photoFileName);
              onDeleted();
            })
            .catch(showError('Could not delete the piece')),
      },
    ]);
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={styles.page}
    >
      <Stack.Screen
        options={{
          headerLeft: () => (
            <Pressable style={styles.cancelButton} onPress={onCancel}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
          ),
          headerRight: () => (
            <Pressable
              style={[styles.saveButton, !canSave && styles.buttonDisabled]}
              onPress={handleSave}
              disabled={!canSave}
            >
              <Text style={styles.saveButtonText}>Save</Text>
            </Pressable>
          ),
        }}
      />
      <View style={styles.card}>
        <TextInput
          style={styles.nameInput}
          value={name}
          onChangeText={setName}
          placeholder="Name"
          placeholderTextColor={colors.secondaryText}
        />
        <View style={[styles.cardRow, styles.separator]}>
          <View style={styles.fill}>
            <JoinedButtons
              options={categoryOptions}
              selected={category}
              onSelect={setCategory}
              style={styles.trackOnCard}
            />
          </View>
        </View>
        {category === 'prep' && (
          <View style={[styles.cardRow, styles.separator]}>
            <View style={styles.fill}>
              <PrepKindField
                kind={prepKind}
                onChangeKind={setPrepKind}
                texts={countTexts}
                onChangeTexts={setCountTexts}
                trackStyle={styles.trackOnCard}
              />
            </View>
          </View>
        )}
      </View>
      <View style={styles.card}>
        <Pressable
          style={({ pressed }) => [styles.cardRow, pressed && styles.buttonPressed]}
          onPress={changePhoto}
        >
          <Text style={[styles.text, styles.fill]}>Photo</Text>
          <Text style={styles.text}>{shownPhotoUri ? 'Change' : 'Add'}</Text>
          <Chevron />
        </Pressable>
        {shownPhotoUri && <Image source={{ uri: shownPhotoUri }} style={styles.photo} />}
      </View>
      <View style={styles.card}>
        <TextInput
          style={styles.notesInput}
          value={notes}
          onChangeText={setNotes}
          placeholder={
            piece.finished_at
              ? getNotesPlaceholder(piece.lost === 1, shownPhotoUri !== null)
              : 'Notes'
          }
          placeholderTextColor={colors.secondaryText}
          multiline
        />
      </View>
      <View style={styles.card}>
        <Pressable
          style={({ pressed }) => [styles.cardRow, pressed && styles.buttonPressed]}
          onPress={confirmDelete}
        >
          <Text style={styles.deleteButtonText}>Delete piece</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    padding: 16,
    gap: 16,
  },
  // A group of rows, the same as Add Work's cards.
  card: {
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  separator: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  fill: {
    flex: 1,
  },
  // The joined buttons' usual track is the card's color, so on a card it takes the page's.
  trackOnCard: {
    backgroundColor: colors.background,
  },
  text: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.text,
  },
  photo: {
    width: '100%',
    aspectRatio: 4 / 3,
    marginBottom: 16,
    borderRadius: 8,
  },
  buttonPressed: {
    opacity: 0.6,
  },
  nameInput: {
    fontSize: 18,
    paddingVertical: 12,
    color: colors.text,
  },
  notesInput: {
    fontSize: 18,
    paddingVertical: 12,
    height: 120,
    textAlignVertical: 'top',
    color: colors.text,
  },
  deleteButtonText: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.danger,
  },
  cancelButton: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  cancelButtonText: {
    fontSize: 16,
    lineHeight: 18,
    color: colors.text,
  },
  saveButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  saveButtonText: {
    fontSize: 16,
    lineHeight: 18,
    color: colors.textOnFill,
  },
});
