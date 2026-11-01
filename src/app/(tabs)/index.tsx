import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import { FinishPiecePanel } from '@/components/FinishPiecePanel';
import type { WorkRecords } from '@/db/queries/dayQueries';
import type { UnfinishedPiece } from '@/db/queries/pieceQueries';
import { useWorkStore } from '@/store/workStore';
import { formatDuration } from '@/utils/formatTime';
import { saveToCameraRoll } from '@/utils/photoStorage';
import { getWorkDays, startOfDay } from '@/utils/workDays';

interface Finishing {
  piece: UnfinishedPiece;
  cameraPhotoUri: string | null;
}

interface RunningTimeProps {
  startedAt: string;
  baseMilliseconds?: number;
  style?: StyleProp<TextStyle>;
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

// The current time, updated every second.
function useNow() {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  return now;
}

function RunningTime({ startedAt, baseMilliseconds = 0, style }: RunningTimeProps) {
  const now = useNow();

  return (
    <Text style={[styles.time, style]}>
      {formatElapsed(baseMilliseconds + now - Date.parse(startedAt))}
    </Text>
  );
}

// "Today: 5h 20m worked, 30m break, 2 finished", counting the running piece up to now.
// Everything is filtered to the current day here, not only when the store loads, so the
// numbers reset at midnight even if nothing is tapped.
function TodayTable({ today }: { today: WorkRecords }) {
  const now = useNow();
  const midnight = startOfDay(now);
  const day = getWorkDays(today.segments, [], today.breaks, now).find(
    (workDay) => workDay.dayStart === midnight,
  );
  const columns = [
    { label: 'Work Today', value: formatDuration(day?.worked ?? 0) },
    { label: 'Break', value: formatDuration(day?.onBreak ?? 0) },
    {
      label: 'Finished',
      value: String(
        today.finishedPieces.filter((piece) => Date.parse(piece.finished_at) >= midnight).length,
      ),
    },
  ];

  return (
    <View style={styles.todayTable}>
      {columns.map(({ label, value }) => (
        <View key={label} style={styles.todayColumn}>
          <Text style={styles.todayLabel}>{label}</Text>
          <Text style={styles.todayValue}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

export default function WorkScreen() {
  const {
    pieces,
    runningBreak,
    today,
    load,
    start,
    switchTo,
    finish,
    takeBreak,
    backToWork,
    endDay,
  } = useWorkStore();
  const [name, setName] = useState('');
  const [finishing, setFinishing] = useState<Finishing | null>(null);
  const [openingPieceId, setOpeningPieceId] = useState<number | null>(null);
  const trimmedName = name.trim();
  const working = pieces.some((piece) => piece.running_since !== null);

  useEffect(() => {
    load().catch(showError('Could not load your work'));
  }, [load]);

  function handleStart() {
    start(trimmedName)
      .then(() => setName(''))
      .catch(showError('Could not start'));
  }

  // The piece's clock keeps running through the camera and notes; Save sets the finish time.
  async function openFinish(piece: UnfinishedPiece) {
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
      setFinishing({ piece, cameraPhotoUri });
    } finally {
      setOpeningPieceId(null);
    }
  }

  const finishPanel = finishing && (
    <FinishPiecePanel
      pieceName={finishing.piece.name}
      cameraPhotoUri={finishing.cameraPhotoUri}
      onCancel={() => setFinishing(null)}
      onSave={(notes) =>
        finish(finishing.piece.id, { notes, cameraPhotoUri: finishing.cameraPhotoUri }).then(() =>
          setFinishing(null),
        )
      }
    />
  );

  return (
    <View style={styles.screen}>
      <View style={styles.startRow}>
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

      <ScrollView style={styles.pieceList} contentContainerStyle={styles.pieceListContent}>
        {pieces.map((piece) => (
          <Pressable
            key={piece.id}
            style={[styles.pieceRow, piece.running_since !== null && styles.pieceRowCurrent]}
            onPress={() => switchTo(piece.id).catch(showError('Could not switch pieces'))}
            disabled={piece.running_since !== null}
          >
            <View style={styles.pieceDetails}>
              <Text style={[styles.pieceName, piece.running_since !== null && styles.currentText]}>
                {piece.name}
              </Text>
              {piece.running_since ? (
                <RunningTime
                  startedAt={piece.running_since}
                  baseMilliseconds={piece.worked_milliseconds}
                  style={styles.currentText}
                />
              ) : (
                <Text style={styles.time}>{formatElapsed(piece.worked_milliseconds)}</Text>
              )}
            </View>
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
          </Pressable>
        ))}
      </ScrollView>

      {runningBreak && (
        <View style={styles.breakRow}>
          <Text style={styles.breakLabel}>On break</Text>
          <RunningTime startedAt={runningBreak.started_at} style={styles.breakTime} />
        </View>
      )}
      {(working || runningBreak) && (
        <View style={styles.controlRow}>
          {runningBreak ? (
            <Pressable
              style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
              onPress={() => backToWork().catch(showError('Could not end the break'))}
            >
              <Text style={styles.buttonText}>Back to work</Text>
            </Pressable>
          ) : (
            <Pressable
              style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
              onPress={() => takeBreak().catch(showError('Could not start the break'))}
            >
              <Text style={styles.buttonText}>Break</Text>
            </Pressable>
          )}
          <Pressable
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={() => endDay().catch(showError('Could not end the day'))}
          >
            <Text style={styles.buttonText}>End day</Text>
          </Pressable>
        </View>
      )}
      <TodayTable today={today} />
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
  startRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  nameInput: {
    flex: 1,
    fontSize: 18,
    padding: 12,
    borderWidth: 1,
    borderColor: '#999',
    borderRadius: 8,
  },
  button: {
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
  pieceList: {
    flex: 1,
  },
  pieceListContent: {
    gap: 12,
  },
  pieceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 28,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: '#eee',
  },
  pieceRowCurrent: {
    backgroundColor: '#2e7d32',
  },
  pieceDetails: {
    flex: 1,
    gap: 6,
  },
  pieceName: {
    fontSize: 20,
  },
  currentText: {
    color: '#fff',
  },
  breakRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#f6ff00',
    height: 200,
    padding: 20,
  },
  breakLabel: {
    flex: 1,
    fontSize: 30,
  },
  controlRow: {
    flexDirection: 'row',
    gap: 12,
  },
  time: {
    fontSize: 18,
    fontVariant: ['tabular-nums'],
  },
  todayTable: {
    flexDirection: 'row',
    gap: 12,
  },
  todayColumn: {
    flex: 1,
    gap: 2,
  },
  todayLabel: {
    fontSize: 16,
    color: '#555',
  },
  todayValue: {
    fontSize: 18,
    fontVariant: ['tabular-nums'],
  },
  breakTime: {
    fontSize: 30,
    fontVariant: ['tabular-nums'],
  },
});
