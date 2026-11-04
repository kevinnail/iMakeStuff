import { useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FinishPiecePanel } from '@/components/FinishPiecePanel';
import { JoinedButtons } from '@/components/JoinedButtons';
import { PrepTag } from '@/components/PrepTag';
import type { WorkRecords } from '@/db/queries/dayQueries';
import type { PieceCategory, UnfinishedPiece } from '@/db/queries/pieceQueries';
import { getAvailablePrep, type AvailablePrep } from '@/db/queries/prepQueries';
import { useWorkStore } from '@/store/workStore';
import { formatDuration } from '@/utils/formatTime';
import { saveToCameraRoll } from '@/utils/photoStorage';
import { colors } from '@/theme';
import { getWorkDays, startOfDay } from '@/utils/workDays';

interface Finishing {
  piece: UnfinishedPiece;
  cameraPhotoUri: string | null;
  availablePrep: AvailablePrep[] | null;
}

interface RunningTimeProps {
  startedAt: string;
  baseMilliseconds?: number;
  style?: StyleProp<TextStyle>;
}

const categoryOptions: { value: PieceCategory; label: string; placeholder: string }[] = [
  { value: 'piece', label: 'Piece', placeholder: 'What are you making?' },
  { value: 'prep', label: 'Prep', placeholder: 'What prep are you making?' },
];

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
// Prep counts as worked but not as finished, since it isn't output.
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
        today.finishedPieces.filter(
          (piece) => piece.category === 'piece' && Date.parse(piece.finished_at) >= midnight,
        ).length,
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
  const [category, setCategory] = useState<PieceCategory>('piece');
  const [finishing, setFinishing] = useState<Finishing | null>(null);
  const [openingPieceId, setOpeningPieceId] = useState<number | null>(null);
  const trimmedName = name.trim();
  const placeholder = categoryOptions.find(({ value }) => value === category)?.placeholder;
  const working = pieces.some((piece) => piece.running_since !== null);

  // Reloads whenever the tab is shown, so fixes made on a day's page show here.
  useFocusEffect(
    useCallback(() => {
      load().catch(showError('Could not load your work'));
    }, [load]),
  );

  function handleStart() {
    Keyboard.dismiss();
    start(trimmedName, category)
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
      const availablePrep = piece.category === 'piece' ? await getAvailablePrep(piece.id) : null;
      setFinishing({ piece, cameraPhotoUri, availablePrep });
    } finally {
      setOpeningPieceId(null);
    }
  }

  const finishPanel = finishing && (
    <FinishPiecePanel
      pieceName={finishing.piece.name}
      cameraPhotoUri={finishing.cameraPhotoUri}
      availablePrep={finishing.availablePrep}
      onCancel={() => setFinishing(null)}
      onSave={(notes, prepUses) =>
        finish(finishing.piece.id, {
          notes,
          cameraPhotoUri: finishing.cameraPhotoUri,
          prepUses,
        }).then(() => setFinishing(null))
      }
    />
  );

  return (
    // The tab bar has no header, so the screen keeps itself clear of the status bar and tab bar.
    <SafeAreaView edges={['top', 'bottom']} style={styles.screen}>
      <JoinedButtons options={categoryOptions} selected={category} onSelect={setCategory} />
      <View style={styles.startRow}>
        <TextInput
          style={styles.nameInput}
          value={name}
          onChangeText={setName}
          placeholder={placeholder}
          placeholderTextColor={colors.secondaryText}
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
              <View style={styles.nameRow}>
                <Text
                  style={[styles.pieceName, piece.running_since !== null && styles.currentText]}
                >
                  {piece.name}
                </Text>
                {piece.category === 'prep' && <PrepTag onFill={piece.running_since !== null} />}
              </View>
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
              style={({ pressed }) => [styles.doneButton, pressed && styles.buttonPressed]}
              onPress={() => openFinish(piece).catch(showError('Could not open the camera'))}
              disabled={openingPieceId !== null}
            >
              <Text
                style={[styles.doneText, openingPieceId === piece.id && styles.buttonTextHidden]}
              >
                Done
              </Text>
              {openingPieceId === piece.id && (
                <ActivityIndicator color={colors.text} style={StyleSheet.absoluteFill} />
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
    </SafeAreaView>
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
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.separator,
    borderRadius: 8,
  },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: colors.primary,
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
    color: colors.textOnFill,
  },
  // Dark so it shows on both a plain row and the running piece's row.
  doneButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: colors.background,
  },
  doneText: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.text,
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
    backgroundColor: colors.surface,
  },
  pieceRowCurrent: {
    backgroundColor: colors.primary,
  },
  pieceDetails: {
    flex: 1,
    gap: 6,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pieceName: {
    flexShrink: 1,
    fontSize: 20,
    color: colors.text,
  },
  currentText: {
    color: colors.textOnFill,
  },
  breakRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.accent,
    height: 200,
    padding: 20,
  },
  breakLabel: {
    flex: 1,
    fontSize: 30,
    color: colors.textOnFill,
  },
  controlRow: {
    flexDirection: 'row',
    gap: 12,
  },
  time: {
    fontSize: 18,
    fontVariant: ['tabular-nums'],
    color: colors.text,
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
    color: colors.secondaryText,
  },
  todayValue: {
    fontSize: 18,
    fontVariant: ['tabular-nums'],
    color: colors.text,
  },
  breakTime: {
    fontSize: 30,
    fontVariant: ['tabular-nums'],
    color: colors.textOnFill,
  },
});
