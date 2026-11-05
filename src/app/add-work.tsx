import DateTimePicker from '@react-native-community/datetimepicker';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Dropdown } from '@/components/Dropdown';
import { getNotesPlaceholder, outcomeOptions, type Outcome } from '@/components/FinishPiecePanel';
import { JoinedButtons } from '@/components/JoinedButtons';
import { addPastWork } from '@/db/queries/entryQueries';
import { getPieces, type PieceCategory, type PieceListItem } from '@/db/queries/pieceQueries';
import { colors } from '@/theme';
import { deletePhoto, getPhotoUri, showPhotoChoices, withSavedPhoto } from '@/utils/photoStorage';

// A category means a new piece or new prep; existing means one already saved.
type Source = PieceCategory | 'existing';

const sourceOptions: { value: Source; label: string; color?: string }[] = [
  { value: 'piece', label: 'New piece' },
  { value: 'prep', label: 'New prep', color: colors.prep },
  { value: 'existing', label: 'Existing' },
];

// Yesterday at the given hour, the most likely day to be catching up on.
function yesterdayAt(hours: number) {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  date.setHours(hours, 0, 0, 0);
  return date.getTime();
}

export default function AddWorkScreen() {
  const [pieces, setPieces] = useState<PieceListItem[]>([]);
  const [source, setSource] = useState<Source>('piece');
  const [chosenPiece, setChosenPiece] = useState<PieceListItem | null>(null);
  const [newName, setNewName] = useState('');
  const [startedAt, setStartedAt] = useState(() => yesterdayAt(9));
  const [endedAt, setEndedAt] = useState(() => yesterdayAt(10));
  const [finishing, setFinishing] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>('good');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  // From the camera or library opening until its photo is ready, which can run on after the
  // library closes while an iCloud photo downloads.
  const [gettingPhoto, setGettingPhoto] = useState(false);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const trimmedName = newName.trim();
  const trimmedNotes = notes.trim();
  const newCategory = source === 'existing' ? null : source;
  const pieceOptions = pieces.map((piece) => {
    const finishedMark = piece.lost ? 'lost' : 'finished';
    const marks = [piece.category === 'prep' && 'prep', piece.finished_at && finishedMark];
    return { key: piece.id, label: piece.name, detail: marks.filter(Boolean).join(', '), piece };
  });
  // A new piece can have a photo whether or not it's finished. An existing piece only takes
  // one with its finish.
  const canAddPhoto = newCategory !== null || finishing;
  // A photo taken on the Work screen before Done, which the finish keeps unless a new one is added.
  const savedPhotoFileName = newCategory === null ? (chosenPiece?.photo_file_name ?? null) : null;
  const shownPhotoUri = photoUri ?? (savedPhotoFileName ? getPhotoUri(savedPhotoFileName) : null);
  const canFinish = newCategory !== null || (chosenPiece !== null && !chosenPiece.finished_at);
  const canSave =
    !saving &&
    !gettingPhoto &&
    (newCategory ? trimmedName !== '' : chosenPiece !== null) &&
    endedAt >= startedAt &&
    (!finishing || shownPhotoUri !== null || trimmedNotes !== '');

  useEffect(() => {
    getPieces()
      .then(setPieces)
      .catch((error: Error) => Alert.alert('Could not load your pieces', error.message));
  }, []);

  function changePhoto() {
    showPhotoChoices({
      canRemove: photoUri !== null,
      onPicked: setPhotoUri,
      onRemove: () => setPhotoUri(null),
      onLoading: setGettingPhoto,
    });
  }

  // A finished existing piece can't be finished again, so every new choice starts unfinished.
  function chooseSource(value: Source) {
    setSource(value);
    setFinishing(false);
  }

  function choosePiece(piece: PieceListItem) {
    setChosenPiece(piece);
    setFinishing(false);
  }

  function handleSave() {
    const piece = newCategory
      ? { name: trimmedName, category: newCategory }
      : chosenPiece && { id: chosenPiece.id };
    if (!piece) return;
    const newPhotoUri = canAddPhoto ? photoUri : null;
    setSaving(true);
    withSavedPhoto(newPhotoUri, (photoFileName) =>
      addPastWork({
        piece,
        startedAt: new Date(startedAt).toISOString(),
        endedAt: new Date(endedAt).toISOString(),
        photoFileName,
        finish: finishing ? { notes: trimmedNotes || null, lost: outcome === 'lost' } : null,
      }),
    )
      .then(() => {
        // The new photo replaced the saved one, so its file goes.
        if (newPhotoUri && savedPhotoFileName) deletePhoto(savedPhotoFileName);
        router.back();
      })
      .catch((error: Error) => {
        setSaving(false);
        Alert.alert('Could not save', error.message);
      });
  }

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.page}>
      <JoinedButtons options={sourceOptions} selected={source} onSelect={chooseSource} />
      {source === 'existing' && (
        <Dropdown
          options={pieceOptions}
          selectedKey={chosenPiece?.id ?? null}
          placeholder="Choose a piece"
          onSelect={({ piece }) => choosePiece(piece)}
        />
      )}
      {newCategory && (
        <TextInput
          style={styles.input}
          value={newName}
          onChangeText={setNewName}
          placeholder="What did you make?"
          placeholderTextColor={colors.secondaryText}
          autoFocus
        />
      )}
      <View style={styles.row}>
        <Text style={styles.label}>Start</Text>
        <DateTimePicker
          value={new Date(startedAt)}
          mode="datetime"
          display="compact"
          accentColor={colors.primary}
          onValueChange={(_event, date) => setStartedAt(date.getTime())}
        />
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>End</Text>
        <DateTimePicker
          value={new Date(endedAt)}
          mode="datetime"
          display="compact"
          accentColor={colors.primary}
          onValueChange={(_event, date) => setEndedAt(date.getTime())}
        />
      </View>
      {canAddPhoto && (
        <>
          {shownPhotoUri && <Image source={{ uri: shownPhotoUri }} style={styles.photo} />}
          <Pressable
            style={({ pressed }) => [styles.photoButton, pressed && styles.buttonPressed]}
            onPress={changePhoto}
            disabled={gettingPhoto}
          >
            <Text style={styles.choiceText}>
              {gettingPhoto ? 'Loading photo…' : shownPhotoUri ? 'Change photo' : 'Add a photo'}
            </Text>
          </Pressable>
        </>
      )}
      {canFinish && (
        <View style={styles.row}>
          <Text style={styles.label}>Finished</Text>
          <Switch
            value={finishing}
            onValueChange={setFinishing}
            trackColor={{ true: colors.primary }}
          />
        </View>
      )}
      {finishing && (
        <>
          <JoinedButtons options={outcomeOptions} selected={outcome} onSelect={setOutcome} />
          <TextInput
            style={[styles.input, styles.notesInput]}
            value={notes}
            onChangeText={setNotes}
            placeholder={getNotesPlaceholder(outcome === 'lost', shownPhotoUri !== null)}
            placeholderTextColor={colors.secondaryText}
            multiline
          />
        </>
      )}
      <View style={styles.buttonRow}>
        <Pressable
          style={[styles.saveButton, !canSave && styles.buttonDisabled]}
          onPress={handleSave}
          disabled={!canSave}
        >
          <Text style={styles.saveButtonText}>Save</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    padding: 16,
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  label: {
    fontSize: 18,
    color: colors.text,
  },
  choiceText: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.text,
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
  photoButton: {
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 8,
  },
  buttonPressed: {
    opacity: 0.6,
  },
  notesInput: {
    height: 100,
    textAlignVertical: 'top',
  },
  photo: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 8,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
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
