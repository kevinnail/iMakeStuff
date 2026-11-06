import { useFocusEffect } from 'expo-router';
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

import { Dropdown } from '@/components/Dropdown';
import { FinishPiecePanel } from '@/components/FinishPiecePanel';
import { getDeleteMessage } from '@/components/PieceEditForm';
import { JoinedButtons } from '@/components/JoinedButtons';
import { getTemplateChoices, type MissingPrep } from '@/components/PrepChoices';
import type { PrepUseChoice } from '@/components/PrepUsePanel';
import { StopTimePanel } from '@/components/StopTimePanel';
import { Tag } from '@/components/Tag';
import type { WorkRecords } from '@/db/queries/dayQueries';
import type { RunningEntry } from '@/db/queries/entryQueries';
import type { PieceCategory, Template, UnfinishedPiece } from '@/db/queries/pieceQueries';
import {
  getAvailablePrep,
  getPiecePrep,
  getTemplatePrep,
  type AvailablePrep,
} from '@/db/queries/prepQueries';
import { useWorkStore } from '@/store/workStore';
import { formatClockTime, formatDuration } from '@/utils/formatTime';
import { getPhotoUri, takePhoto } from '@/utils/photoStorage';
import { getShareValue } from '@/utils/prepTime';
import { getLastTouch, isQuestionDue } from '@/utils/stillWorking';
import { colors } from '@/theme';
import { getWholeDays, startOfDay } from '@/utils/workDays';
import { showError } from '@/utils/showError';

interface Finishing {
  piece: UnfinishedPiece;
  cameraPhotoUri: string | null;
  availablePrep: AvailablePrep[] | null;
  initialPrep: PrepUseChoice[];
  missingPrep: MissingPrep[];
}

interface RunningTimeProps {
  startedAt: string;
  baseMilliseconds?: number;
  style?: StyleProp<TextStyle>;
}

const categoryOptions: {
  value: PieceCategory;
  label: string;
  placeholder: string;
  color?: string;
}[] = [
  { value: 'piece', label: 'Piece', placeholder: 'What are you making?' },
  { value: 'prep', label: 'Prep', placeholder: 'What prep are you making?', color: colors.prep },
];

function formatElapsed(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function confirmDelete(piece: UnfinishedPiece, remove: (pieceId: number) => Promise<void>) {
  const runningMilliseconds = piece.running_since
    ? Date.now() - Date.parse(piece.running_since)
    : 0;
  Alert.alert(
    `Delete ${piece.name}?`,
    getDeleteMessage(piece.worked_milliseconds + runningMilliseconds, 0),
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => remove(piece.id).catch(showError('Could not delete the piece')),
      },
    ],
  );
}

async function loadFinishPrep(piece: UnfinishedPiece) {
  if (piece.category === 'prep') return { availablePrep: null, initialPrep: [], missingPrep: [] };
  const [availablePrep, usedPrep, templateUses] = await Promise.all([
    getAvailablePrep(piece.id),
    getPiecePrep(piece.id),
    piece.template_id === null ? [] : getTemplatePrep(piece.template_id),
  ]);
  const savedPrep = usedPrep.map((use) => ({
    prep: {
      id: use.prep_id,
      name: use.prep_name,
      otherPiecesShare: use.shares_total - getShareValue(use),
      usedUp: use.prep_used_up === 1,
    },
    share: { share_numerator: use.share_numerator, share_denominator: use.share_denominator },
    useId: use.id,
  }));
  const template = getTemplateChoices(
    templateUses.filter((use) => !usedPrep.some((saved) => saved.prep_name === use.prep_name)),
  );
  return {
    availablePrep,
    initialPrep: [...savedPrep, ...template.chosen],
    missingPrep: template.missing,
  };
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
// Prep and lost pieces count as worked but not as finished, since they aren't output.
// Everything is filtered to the current day here, not only when the store loads, so the
// numbers reset at midnight even if nothing is tapped.
function TodayTable({ today }: { today: WorkRecords }) {
  const now = useNow();
  const midnight = startOfDay(now);
  const day = getWholeDays(today.segments, today.breaks, now).find(
    (workDay) => workDay.dayStart === midnight,
  );
  const columns = [
    { label: 'Work Today', value: formatDuration(day?.worked ?? 0) },
    { label: 'Break', value: formatDuration(day?.onBreak ?? 0) },
    {
      label: 'Finished',
      value: String(
        today.finishedPieces.filter(
          (piece) =>
            piece.category === 'piece' && !piece.lost && Date.parse(piece.finished_at) >= midnight,
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

function StillWorkingQuestion({
  entry,
  onPickTime,
}: {
  entry: RunningEntry;
  onPickTime: () => void;
}) {
  const now = useNow();
  const { confirmRunning, stopRunning } = useWorkStore();
  if (!isQuestionDue(entry, now)) return null;
  const lastTouch = getLastTouch(entry);
  const onBreak = entry.kind === 'break';
  const question = onBreak
    ? `On break for ${formatDuration(now - Date.parse(entry.started_at))}. Still on break?`
    : `${entry.piece_name} has run ${formatDuration(now - lastTouch)} since your last tap. Still working?`;

  return (
    <View style={styles.question}>
      <Text style={styles.questionText}>{question}</Text>
      <View style={styles.answerRow}>
        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={() => confirmRunning(entry).catch(showError('Could not save'))}
        >
          <Text style={styles.buttonText}>{onBreak ? 'Still on break' : 'Still working'}</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.answerButton, pressed && styles.buttonPressed]}
          onPress={() => stopRunning(entry, null).catch(showError('Could not save'))}
        >
          <Text style={styles.answerText}>I stopped at {formatClockTime(lastTouch)}</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.answerButton, pressed && styles.buttonPressed]}
          onPress={onPickTime}
        >
          <Text style={styles.answerText}>Pick a time</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function WorkScreen() {
  const {
    pieces,
    runningBreak,
    runningEntry,
    templates,
    today,
    load,
    start,
    startFromTemplate,
    switchTo,
    addPhoto,
    finish,
    remove,
    takeBreak,
    backToWork,
    endDay,
    stopRunning,
  } = useWorkStore();
  const [name, setName] = useState('');
  const [category, setCategory] = useState<PieceCategory>('piece');
  const [finishing, setFinishing] = useState<Finishing | null>(null);
  const [openingPieceId, setOpeningPieceId] = useState<number | null>(null);
  const [photographingPieceId, setPhotographingPieceId] = useState<number | null>(null);
  const [pickingStopFor, setPickingStopFor] = useState<RunningEntry | null>(null);
  const trimmedName = name.trim();
  const placeholder = categoryOptions.find(({ value }) => value === category)?.placeholder;
  const templateOptions = templates
    .filter((template) => template.category === category)
    .map((template) => ({
      key: template.id,
      label: template.name,
      photoFileName: template.photo_file_name,
      template,
    }));
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

  function startFrom(template: Template) {
    Keyboard.dismiss();
    startFromTemplate(template.id).catch(showError('Could not start'));
  }

  function photograph(piece: UnfinishedPiece) {
    setPhotographingPieceId(piece.id);
    takePhoto()
      .then((uri) => (uri ? addPhoto(piece, uri) : undefined))
      .catch(showError('Could not save the photo'))
      .finally(() => setPhotographingPieceId(null));
  }

  // The piece's clock keeps running through the camera and notes; Save sets the finish time.
  // A photo taken before Done is the piece's photo, so the camera only opens without one.
  async function openFinish(piece: UnfinishedPiece) {
    setOpeningPieceId(piece.id);
    try {
      const cameraPhotoUri = piece.photo_file_name ? null : await takePhoto();
      setFinishing({ piece, cameraPhotoUri, ...(await loadFinishPrep(piece)) });
    } finally {
      setOpeningPieceId(null);
    }
  }

  const finishPanel = finishing && (
    <FinishPiecePanel
      pieceName={finishing.piece.name}
      photoUri={
        finishing.cameraPhotoUri ??
        (finishing.piece.photo_file_name ? getPhotoUri(finishing.piece.photo_file_name) : null)
      }
      availablePrep={finishing.availablePrep}
      initialPrep={finishing.initialPrep}
      missingPrep={finishing.missingPrep}
      onCancel={() => setFinishing(null)}
      onSave={(notes, lost, prepUses) =>
        finish(finishing.piece.id, {
          notes,
          cameraPhotoUri: finishing.cameraPhotoUri,
          savedPhotoFileName: finishing.piece.photo_file_name,
          lost,
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
      {templateOptions.length > 0 && (
        <Dropdown
          options={templateOptions}
          selectedKey={null}
          placeholder="Or start from a template"
          onSelect={({ template }) => startFrom(template)}
          floating
        />
      )}
      {runningEntry && (
        <StillWorkingQuestion
          entry={runningEntry}
          onPickTime={() => setPickingStopFor(runningEntry)}
        />
      )}

      <ScrollView style={styles.pieceList} contentContainerStyle={styles.pieceListContent}>
        {pieces.map((piece) => (
          <Pressable
            key={piece.id}
            style={[
              styles.pieceRow,
              piece.running_since !== null &&
                (piece.category === 'prep' ? styles.prepRowCurrent : styles.pieceRowCurrent),
            ]}
            onPress={
              piece.running_since === null
                ? () => switchTo(piece.id).catch(showError('Could not switch pieces'))
                : undefined
            }
            onLongPress={() => confirmDelete(piece, remove)}
          >
            <View style={styles.nameRow}>
              <Text style={[styles.pieceName, piece.running_since !== null && styles.currentText]}>
                {piece.name}
              </Text>
              {piece.category === 'prep' && (
                <Tag label="Prep" onFill={piece.running_since !== null} />
              )}
            </View>
            <View style={styles.pieceBottomRow}>
              <View style={styles.timeArea}>
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
              {piece.running_since !== null && (
                <Pressable
                  style={({ pressed }) => [styles.photoButton, pressed && styles.buttonPressed]}
                  onPress={() => photograph(piece)}
                  disabled={photographingPieceId !== null}
                >
                  <Text style={styles.photoText}>{piece.photo_file_name ? 'Retake' : 'Photo'}</Text>
                </Pressable>
              )}
              <Pressable
                style={({ pressed }) => [styles.doneButton, pressed && styles.buttonPressed]}
                onPress={() => openFinish(piece).catch(showError('Could not open the camera'))}
                // Done waits for a photo still saving, or it would finish with the old one.
                disabled={openingPieceId !== null || photographingPieceId !== null}
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
            </View>
          </Pressable>
        ))}
      </ScrollView>

      {runningBreak && (
        <View style={styles.breakRow}>
          <Text style={styles.breakLabel}>On break</Text>
          <RunningTime startedAt={runningBreak.started_at} style={styles.breakTime} />
        </View>
      )}
      {/* Break shows even with nothing running, so time between pieces can be counted. */}
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
        {(working || runningBreak) && (
          <Pressable
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={() => endDay().catch(showError('Could not end the day'))}
          >
            <Text style={styles.buttonText}>End day</Text>
          </Pressable>
        )}
      </View>
      <TodayTable today={today} />
      {finishPanel}
      {pickingStopFor && (
        <StopTimePanel
          title={
            pickingStopFor.kind === 'break'
              ? 'When did the break end?'
              : `When did you stop working on ${pickingStopFor.piece_name}?`
          }
          startedAt={Date.parse(pickingStopFor.started_at)}
          initialEndedAt={getLastTouch(pickingStopFor)}
          onCancel={() => setPickingStopFor(null)}
          onSave={(endedAt) =>
            stopRunning(pickingStopFor, new Date(endedAt).toISOString()).then(() =>
              setPickingStopFor(null),
            )
          }
        />
      )}
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

  photoButton: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.textOnFill,
    borderRadius: 8,
  },
  photoText: {
    fontSize: 16,
    lineHeight: 18,
    color: colors.textOnFill,
  },
  question: {
    gap: 12,
    padding: 16,
    borderWidth: 2,
    borderColor: colors.accent,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  questionText: {
    fontSize: 18,
    color: colors.text,
  },
  answerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  answerButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 8,
  },
  answerText: {
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
    gap: 12,
    paddingVertical: 20,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  pieceRowCurrent: {
    backgroundColor: colors.primary,
  },
  prepRowCurrent: {
    backgroundColor: colors.prep,
  },
  pieceBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  timeArea: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pieceName: {
    flexShrink: 1,
    fontSize: 24,
    fontWeight: '700',
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
    fontSize: 22,
    fontWeight: '600',
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
