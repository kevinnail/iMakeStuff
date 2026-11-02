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

import { addPastWork } from '@/db/queries/entryQueries';
import { getPieces, type PieceListItem } from '@/db/queries/pieceQueries';
import { withSavedPhoto } from '@/utils/photoStorage';

type PieceChoice = PieceListItem | 'new' | null;

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
  const [libraryPhotoUri, setLibraryPhotoUri] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const trimmedName = newName.trim();
  const trimmedNotes = notes.trim();
  const canFinish = pieceChoice === 'new' || (pieceChoice !== null && !pieceChoice.finished_at);
  const canSave =
    !saving &&
    (pieceChoice === 'new' ? trimmedName !== '' : pieceChoice !== null) &&
    endedAt >= startedAt &&
    (!finishing || libraryPhotoUri !== null || trimmedNotes !== '');

  useEffect(() => {
    getPieces()
      .then(setPieces)
      .catch((error: Error) => Alert.alert('Could not load your pieces', error.message));
  }, []);

  function choosePiece() {
    const options = [
      ...pieces.map((piece) => (piece.finished_at ? `${piece.name} (finished)` : piece.name)),
      'New piece…',
      'Cancel',
    ];
    ActionSheetIOS.showActionSheetWithOptions(
      { options, cancelButtonIndex: options.length - 1 },
      (index) => {
        if (index === pieces.length) setPieceChoice('new');
        else if (index < pieces.length) setPieceChoice(pieces[index]);
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
    setSaving(true);
    withSavedPhoto(finishing ? libraryPhotoUri : null, (photoFileName) =>
      addPastWork({
        piece: pieceChoice === 'new' ? { name: trimmedName } : { id: pieceChoice.id },
        startedAt: new Date(startedAt).toISOString(),
        endedAt: new Date(endedAt).toISOString(),
        finish: finishing ? { notes: trimmedNotes || null, photoFileName } : null,
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
          <Text style={styles.choiceText}>
            {pieceChoice === 'new' ? 'New piece' : (pieceChoice?.name ?? 'Choose a piece')}
          </Text>
        </Pressable>
      </View>
      {pieceChoice === 'new' && (
        <TextInput
          style={styles.input}
          value={newName}
          onChangeText={setNewName}
          placeholder="What did you make?"
          autoFocus
        />
      )}
      <View style={styles.row}>
        <Text style={styles.label}>Start</Text>
        <DateTimePicker
          value={new Date(startedAt)}
          mode="datetime"
          display="compact"
          onValueChange={(_event, date) => setStartedAt(date.getTime())}
        />
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>End</Text>
        <DateTimePicker
          value={new Date(endedAt)}
          mode="datetime"
          display="compact"
          onValueChange={(_event, date) => setEndedAt(date.getTime())}
        />
      </View>
      {canFinish && (
        <View style={styles.row}>
          <Text style={styles.label}>Finished</Text>
          <Switch value={finishing} onValueChange={setFinishing} />
        </View>
      )}
      {finishing && (
        <>
          {libraryPhotoUri && <Image source={{ uri: libraryPhotoUri }} style={styles.photo} />}
          <Pressable
            style={styles.choiceButton}
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
            placeholder={libraryPhotoUri ? 'Notes' : 'No photo: describe the piece.'}
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
  },
  choiceButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#eee',
  },
  choiceText: {
    fontSize: 18,
    lineHeight: 20,
  },
  input: {
    fontSize: 18,
    padding: 12,
    borderWidth: 1,
    borderColor: '#999',
    borderRadius: 8,
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
    backgroundColor: '#1a1a1a',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  saveButtonText: {
    fontSize: 18,
    lineHeight: 20,
    color: '#fff',
  },
});
