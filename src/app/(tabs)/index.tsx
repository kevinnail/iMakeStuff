import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { FinishPiecePanel } from '@/components/FinishPiecePanel';
import type { RunningPiece } from '@/db/queries/pieceQueries';
import { useWorkStore } from '@/store/workStore';
import { saveToCameraRoll } from '@/utils/photoStorage';

interface Finishing {
  piece: RunningPiece;
  endedAt: string;
  cameraPhotoUri: string | null;
}

function formatElapsed(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function showError(title: string) {
  return (error: Error) => Alert.alert(title, error.message);
}

function RunningTime({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  return <Text style={styles.runningTime}>{formatElapsed(now - Date.parse(startedAt))}</Text>;
}

export default function WorkScreen() {
  const { runningPieces, load, start, finish } = useWorkStore();
  const [name, setName] = useState('');
  const [finishing, setFinishing] = useState<Finishing | null>(null);
  const [openingPieceId, setOpeningPieceId] = useState<number | null>(null);
  const trimmedName = name.trim();

  useEffect(() => {
    load().catch(showError('Could not load your work'));
  }, [load]);

  function handleStart() {
    start(trimmedName)
      .then(() => setName(''))
      .catch(showError('Could not start'));
  }

  async function openFinish(piece: RunningPiece) {
    const endedAt = new Date().toISOString();
    setOpeningPieceId(piece.id);
    try {
      const { granted } = await ImagePicker.requestCameraPermissionsAsync();
      const result = granted ? await ImagePicker.launchCameraAsync({ quality: 0.85 }) : null;
      const cameraPhotoUri = result && !result.canceled ? result.assets[0].uri : null;
      if (cameraPhotoUri) {
        await saveToCameraRoll(cameraPhotoUri).catch(
          showError('Could not save the photo to your camera roll'),
        );
      }
      setFinishing({ piece, endedAt, cameraPhotoUri });
    } finally {
      setOpeningPieceId(null);
    }
  }

  const finishPanel = finishing && (
    <FinishPiecePanel
      key={finishing.endedAt}
      pieceName={finishing.piece.name}
      cameraPhotoUri={finishing.cameraPhotoUri}
      onCancel={() => setFinishing(null)}
      onSave={(notes) =>
        finish(finishing.piece.id, {
          endedAt: finishing.endedAt,
          notes,
          cameraPhotoUri: finishing.cameraPhotoUri,
        }).then(() => setFinishing(null))
      }
    />
  );

  if (runningPieces.length === 0) {
    return (
      <View style={styles.screen}>
        <TextInput
          style={styles.nameInput}
          value={name}
          onChangeText={setName}
          placeholder="What are you making?"
          returnKeyType="go"
          onSubmitEditing={trimmedName ? handleStart : undefined}
        />
        <Pressable
          style={[styles.button, !trimmedName && styles.buttonDisabled]}
          onPress={handleStart}
          disabled={!trimmedName}
        >
          <Text style={styles.buttonText}>Start</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {runningPieces.map((piece) => (
        <View key={piece.id} style={styles.pieceRow}>
          <Text style={styles.pieceName}>{piece.name}</Text>
          <RunningTime startedAt={piece.started_at} />
          <Pressable
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={() => openFinish(piece).catch(showError('Could not open the camera'))}
            disabled={openingPieceId !== null}
          >
            <Text
              style={[styles.buttonText, openingPieceId === piece.id && styles.buttonTextHidden]}
            >
              Done
            </Text>
            {openingPieceId === piece.id && (
              <ActivityIndicator color="#fff" style={StyleSheet.absoluteFill} />
            )}
          </Pressable>
        </View>
      ))}
      {finishPanel}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    padding: 16,
    gap: 12,
  },
  nameInput: {
    fontSize: 18,
    padding: 12,
    borderWidth: 1,
    borderColor: '#999',
    borderRadius: 8,
  },
  button: {
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: '#1a1a1a',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonPressed: {
    opacity: 0.6,
  },
  buttonText: {
    fontSize: 18,
    lineHeight: 20,
    color: '#fff',
  },
  buttonTextHidden: {
    opacity: 0,
  },
  pieceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  pieceName: {
    flex: 1,
    fontSize: 18,
  },
  runningTime: {
    fontSize: 18,
    fontVariant: ['tabular-nums'],
  },
});
