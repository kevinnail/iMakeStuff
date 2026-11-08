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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Dropdown } from '@/components/Dropdown';
import { FinishPiecePanel } from '@/components/FinishPiecePanel';
import { showQuickStart } from '@/components/FirstRunGuide';
import { getDeleteMessage } from '@/components/PieceEditForm';
import { JoinedButtons } from '@/components/JoinedButtons';
import { getTemplateChoices, type MissingUse } from '@/components/UseChoices';
import { getSavedChoice, type UseChoice } from '@/components/UsePanel';
import { StopTimePanel } from '@/components/StopTimePanel';
import { Tag } from '@/components/Tag';
import type { WorkRecords } from '@/db/queries/dayQueries';
import type { RunningEntry } from '@/db/queries/entryQueries';
import type { PieceCategory, Template, UnfinishedPiece } from '@/db/queries/pieceQueries';
import {
  getAvailablePrep,
  getPiecePrep,
  getTemplateUses,
  type AvailablePrep,
} from '@/db/queries/prepQueries';
import {
  getAvailableSupplies,
  getPieceSupplies,
  type AvailableSupply,
} from '@/db/queries/supplyQueries';
import { useGuideStore } from '@/store/guideStore';
import { useWorkStore } from '@/store/workStore';
import { formatClockTime, formatDuration } from '@/utils/formatTime';
import { getPhotoUri, takePhoto } from '@/utils/photoStorage';
import { getLastTouch, isQuestionDue } from '@/utils/stillWorking';
import { colors } from '@/theme';
import { getWholeDays, startOfDay } from '@/utils/workDays';
import { showError } from '@/utils/showError';

interface Finishing {
  piece: UnfinishedPiece;
  cameraPhotoUri: string | null;
  availablePrep: AvailablePrep[] | null;
  initialPrep: UseChoice[];
  missingPrep: MissingUse[];
  availableSupplies: AvailableSupply[];
  initialSupplies: UseChoice[];
  missingSupplies: MissingUse[];
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

// What the panel after Done starts with: the prep (for a piece) and the supplies already on it,
// then its template's (Decisions: Record once, then just make), and what can be added. Prep
// takes no prep, and a batch of a counted template takes no supplies from it, since the template
// knows them.
async function loadFinishUses(piece: UnfinishedPiece) {
  const usesPrep = piece.category === 'piece';
  const [availablePrep, usedPrep, availableSupplies, usedSupplies] = await Promise.all([
    usesPrep ? getAvailablePrep(piece.id) : null,
    usesPrep ? getPiecePrep(piece.id) : [],
    getAvailableSupplies(piece.id),
    getPieceSupplies(piece.id),
  ]);
  const template =
    piece.template_id === null
      ? null
      : await getTemplateUses(piece.template_id, piece.id, {
          prep: availablePrep ?? [],
          supplies: availableSupplies,
        });
  const prep = getTemplateChoices(
    usesPrep ? (template?.prep ?? []) : [],
    usedPrep.map((use) =>
      getSavedChoice(use, {
        id: use.prep_id,
        name: use.prep_name,
        size_amount: use.size_amount,
        size_unit: use.size_unit,
      }),
    ),
  );
  const supplies = getTemplateChoices(
    piece.template_counted ? [] : (template?.supplies ?? []),
    usedSupplies.map((use) =>
      getSavedChoice(use, {
        id: use.supply_id,
        name: use.supply_name,
        size_amount: use.size_amount,
        size_unit: use.size_unit,
      }),
    ),
  );
  return {
    availablePrep,
    initialPrep: prep.chosen,
    missingPrep: prep.missing,
    availableSupplies,
    initialSupplies: supplies.chosen,
    missingSupplies: supplies.missing,
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
  const guideTarget = useGuideStore((state) => state.target);
  const setTabBarHeight = useGuideStore((state) => state.setTabBarHeight);
  const { bottom: bottomInset } = useSafeAreaInsets();
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

  useEffect(() => setTabBarHeight(bottomInset), [bottomInset, setTabBarHeight]);

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
      setFinishing({ piece, cameraPhotoUri, ...(await loadFinishUses(piece)) });
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
      availableSupplies={finishing.availableSupplies}
      initialSupplies={finishing.initialSupplies}
      missingSupplies={finishing.missingSupplies}
      initialSize={finishing.piece}
      laterBatch={finishing.piece.template_counted === 1}
      fromTemplate={finishing.piece.template_id !== null}
      onCancel={() => setFinishing(null)}
      onSave={(notes, lost, isTemplate, prepUses, supplyUses, size) =>
        finish(finishing.piece.id, {
          notes,
          cameraPhotoUri: finishing.cameraPhotoUri,
          savedPhotoFileName: finishing.piece.photo_file_name,
          lost,
          isTemplate,
          prepUses,
          supplyUses,
          ...size,
        }).then(() => setFinishing(null))
      }
    />
  );

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.screen}>
      <View style={styles.categoryRow}>
        <JoinedButtons
          options={categoryOptions}
          selected={category}
          onSelect={setCategory}
          style={styles.categoryButtons}
        />
        <Pressable
          style={({ pressed }) => [styles.helpButton, pressed && styles.buttonPressed]}
          onPress={showQuickStart}
          accessibilityLabel="Show Quick Start"
        >
          <Text style={styles.helpButtonText}>?</Text>
        </Pressable>
      </View>
      <View style={[styles.startRow, guideTarget === 'start' && styles.guideOutline]}>
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
  categoryRow: {
    flexDirection: 'row',
    gap: 12,
  },
  categoryButtons: {
    flex: 1,
  },
  // As tall as Piece and Prep beside it: their 2 of track and 6 of padding, around 18 of text.
  helpButton: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  helpButtonText: {
    fontSize: 16,
    lineHeight: 18,
    fontWeight: '600',
    color: colors.text,
  },
  startRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  // The first-run guide's ring around the button it's pointing at. An outline takes no room, so
  // nothing moves when it shows.
  guideOutline: {
    outlineWidth: 3,
    outlineOffset: 4,
    outlineColor: colors.warning,
    borderRadius: 8,
    boxShadow: `0px 0px 50px ${colors.warning}`,
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
