import * as ImagePicker from 'expo-image-picker';
import { Stack } from 'expo-router';
import { useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';

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
import { deletePhoto, getPhotoUri, saveToCameraRoll, withSavedPhoto } from '@/utils/photoStorage';

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

function showError(title: string) {
  return (error: Error) => Alert.alert(title, error.message);
}

function getDeleteMessage(worked: number, usedByCount: number) {
  const workLine = `Its ${formatDuration(worked)} of work comes off the days it was worked.`;
  if (usedByCount === 0) return workLine;
  const pieces = usedByCount === 1 ? 'the piece' : `the ${usedByCount} pieces`;
  return `${workLine} It comes off ${pieces} that used it.`;
}

async function takePhoto() {
  const { granted } = await ImagePicker.requestCameraPermissionsAsync();
  const result = granted ? await ImagePicker.launchCameraAsync({ quality: 0.85 }) : null;
  if (!result || result.canceled) return null;
  const uri = result.assets[0].uri;
  await saveToCameraRoll(uri).catch(showError('Could not save the photo to your camera roll'));
  return uri;
}

async function choosePhoto() {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.85,
  });
  return result.canceled ? null : result.assets[0].uri;
}

// The piece's page as a form, the way iOS Contacts edits a contact: Cancel and Save in the
// header, the photo, name, Piece or Prep, and notes, then Delete piece at the bottom.
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
    const choices = [
      { label: 'Take photo', pick: takePhoto },
      { label: 'Choose from library', pick: choosePhoto },
    ];
    const options = choices.map(({ label }) => label);
    if (shownPhotoUri) options.push('Remove photo');
    options.push('Cancel');
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options,
        cancelButtonIndex: options.length - 1,
        destructiveButtonIndex: shownPhotoUri ? choices.length : undefined,
      },
      (index) => {
        if (index < choices.length) {
          choices[index]
            .pick()
            .then((uri) => uri && setPhoto({ kind: 'new', uri }))
            .catch(showError('Could not get the photo'));
        } else if (shownPhotoUri && index === choices.length) setPhoto({ kind: 'none' });
      },
    );
  }

  async function save() {
    const details = { name: trimmedName, category, notes: trimmedNotes || null };
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
    setSaving(true);
    save()
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
      {shownPhotoUri && <Image source={{ uri: shownPhotoUri }} style={styles.photo} />}
      <Pressable
        style={({ pressed }) => [styles.outlinedButton, pressed && styles.buttonPressed]}
        onPress={changePhoto}
      >
        <Text style={styles.outlinedButtonText}>
          {shownPhotoUri ? 'Change photo' : 'Add photo'}
        </Text>
      </Pressable>
      <TextInput
        style={[styles.input, styles.nameInput]}
        value={name}
        onChangeText={setName}
        placeholder="Name"
        placeholderTextColor={colors.secondaryText}
      />
      <JoinedButtons options={categoryOptions} selected={category} onSelect={setCategory} />
      <TextInput
        style={[styles.input, styles.notesInput]}
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
      <Pressable
        style={({ pressed }) => [styles.deleteButton, pressed && styles.buttonPressed]}
        onPress={confirmDelete}
      >
        <Text style={styles.deleteButtonText}>Delete piece</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    padding: 16,
    gap: 12,
  },
  photo: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 8,
  },
  outlinedButton: {
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 8,
  },
  outlinedButtonText: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.text,
  },
  buttonPressed: {
    opacity: 0.6,
  },
  input: {
    fontSize: 18,
    padding: 12,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.separator,
    borderRadius: 8,
  },
  nameInput: {
    fontSize: 20,
  },
  notesInput: {
    height: 120,
    textAlignVertical: 'top',
  },
  deleteButton: {
    alignSelf: 'flex-start',
    marginTop: 12,
    paddingVertical: 10,
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
