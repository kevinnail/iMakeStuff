import DateTimePicker from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActionSheetIOS,
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

import { getNotesPlaceholder, outcomeOptions, type Outcome } from '@/components/FinishPiecePanel';
import { JoinedButtons } from '@/components/JoinedButtons';
import { addPastWork } from '@/db/queries/entryQueries';
import { getPieces, type PieceCategory, type PieceListItem } from '@/db/queries/pieceQueries';
import { colors } from '@/theme';
import { withSavedPhoto } from '@/utils/photoStorage';

// A category on its own means a new piece or new prep.
type PieceChoice = PieceListItem | PieceCategory | null;

const newOptions: { category: PieceCategory; label: string; buttonText: string }[] = [
  { category: 'piece', label: 'New piece…', buttonText: 'New piece' },
  { category: 'prep', label: 'New prep…', buttonText: 'New prep' },
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
  const [pieceChoice, setPieceChoice] = useState<PieceChoice>(null);
  const [newName, setNewName] = useState('');
  const [startedAt, setStartedAt] = useState(() => yesterdayAt(9));
  const [endedAt, setEndedAt] = useState(() => yesterdayAt(10));
  const [finishing, setFinishing] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>('good');
  const [libraryPhotoUri, setLibraryPhotoUri] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const trimmedName = newName.trim();
  const trimmedNotes = notes.trim();
  const newCategory = typeof pieceChoice === 'string' ? pieceChoice : null;
  const chosenPiece = typeof pieceChoice === 'string' ? null : pieceChoice;
  const choiceText = newCategory
    ? newOptions.find(({ category }) => category === newCategory)?.buttonText
    : (chosenPiece?.name ?? 'Choose a piece');
  const canFinish = newCategory !== null || (chosenPiece !== null && !chosenPiece.finished_at);
  const canSave =
    !saving &&
    (newCategory ? trimmedName !== '' : chosenPiece !== null) &&
    endedAt >= startedAt &&
    (!finishing || libraryPhotoUri !== null || trimmedNotes !== '');

  useEffect(() => {
    getPieces()
      .then(setPieces)
      .catch((error: Error) => Alert.alert('Could not load your pieces', error.message));
  }, []);

  function choosePiece() {
    const options = [
      ...pieces.map((piece) => {
        const finishedMark = piece.lost ? 'lost' : 'finished';
        const marks = [piece.category === 'prep' && 'prep', piece.finished_at && finishedMark];
        const markText = marks.filter(Boolean).join(', ');
        return markText ? `${piece.name} (${markText})` : piece.name;
      }),
      ...newOptions.map(({ label }) => label),
      'Cancel',
    ];
    ActionSheetIOS.showActionSheetWithOptions(
      { options, cancelButtonIndex: options.length - 1 },
      (index) => {
        if (index < pieces.length) setPieceChoice(pieces[index]);
        else if (index < pieces.length + newOptions.length) {
          setPieceChoice(newOptions[index - pieces.length].category);
        }
        setFinishing(false);
      },
    );
  }

  async function choosePhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
    });
    if (!result.canceled) setLibraryPhotoUri(result.assets[0].uri);
  }

  function handleSave() {
    if (pieceChoice === null) return;
    const piece =
      typeof pieceChoice === 'string'
        ? { name: trimmedName, category: pieceChoice }
        : { id: pieceChoice.id };
    setSaving(true);
    withSavedPhoto(finishing ? libraryPhotoUri : null, (photoFileName) =>
      addPastWork({
        piece,
        startedAt: new Date(startedAt).toISOString(),
        endedAt: new Date(endedAt).toISOString(),
        finish: finishing
          ? { notes: trimmedNotes || null, photoFileName, lost: outcome === 'lost' }
          : null,
      }),
    )
      .then(() => router.back())
      .catch((error: Error) => {
        setSaving(false);
        Alert.alert('Could not save', error.message);
      });
  }

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.page}>
      <View style={styles.row}>
        <Text style={styles.label}>Piece</Text>
        <Pressable style={styles.choiceButton} onPress={choosePiece}>
          <Text style={styles.choiceText}>{choiceText}</Text>
        </Pressable>
      </View>
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
          {libraryPhotoUri && <Image source={{ uri: libraryPhotoUri }} style={styles.photo} />}
          <Pressable
            style={({ pressed }) => [styles.photoButton, pressed && styles.buttonPressed]}
            onPress={() =>
              choosePhoto().catch((error: Error) =>
                Alert.alert('Could not open your photos', error.message),
              )
            }
          >
            <Text style={styles.choiceText}>
              {libraryPhotoUri ? 'Choose a different photo' : 'Choose a photo'}
            </Text>
          </Pressable>
          <TextInput
            style={[styles.input, styles.notesInput]}
            value={notes}
            onChangeText={setNotes}
            placeholder={getNotesPlaceholder(outcome === 'lost', libraryPhotoUri !== null)}
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
  choiceButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: colors.surface,
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
