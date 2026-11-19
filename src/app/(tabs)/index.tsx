import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  type ScrollViewInstance,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import Animated, { CurvedTransition, Easing, LinearTransition } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Dropdown } from '@/components/Dropdown';
import { FinishPiecePanel } from '@/components/FinishPiecePanel';
import { showGuide } from '@/components/FirstRunGuide';
import { getDeleteMessage } from '@/components/PieceEditForm';
import { JoinedButtons } from '@/components/JoinedButtons';
import { RenamePanel } from '@/components/RenamePanel';
import { SwipeRow, type SwipeAction } from '@/components/SwipeRow';
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
import { useGuideStore, useGuideTarget } from '@/store/guideStore';
import { useWorkStore } from '@/store/workStore';
import { formatClockTime, formatDuration } from '@/utils/formatTime';
import { getPhotoUri, takePhoto } from '@/utils/photoStorage';
import { getLastTouch, isQuestionDue } from '@/utils/stillWorking';
import { colors } from '@/theme';
import { getWholeDays, startOfDay } from '@/utils/workDays';
import { showError } from '@/utils/showError';

interface Finishing {
  piece: UnfinishedPiece;
  lost: boolean;
  cameraPhotoUri: string | null;
  availablePrep: AvailablePrep[];
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

interface RowSlideKnobs {
  style: 'straight' | 'spring' | 'curved';
  durationMilliseconds: number;
  delayMilliseconds: number;
  easing: typeof Easing.linear;
  springDamping: number;
  springStiffness: number;
  springMass: number;
}

// Knobs for how the rows slide when the running piece changes. Change a value, save, and the dev
// build reloads with it. Each one is a setting on Reanimated's layout transition.
const rowSlide: RowSlideKnobs = {
  // Which motion:
  //   'straight' slides each row in a straight line. Uses durationMilliseconds, delayMilliseconds,
  //     and easing.
  //   'spring' runs past its spot and settles back, like a spring. Uses delayMilliseconds and the
  //     three spring numbers; durationMilliseconds and easing do nothing here.
  //   'curved' moves along a slight curve, since across and down use different easing. Uses
  //     durationMilliseconds and delayMilliseconds.
  style: 'spring',
  // style: 'curved',
  // How long the slide takes. Reanimated's own default is 300.
  durationMilliseconds: 600,
  // A wait before the slide starts, after the tap.
  delayMilliseconds: 0,
  // How speed changes during a straight slide. Swap in any of these:
  //   Easing.linear                    the same speed start to finish
  //   Easing.inOut(Easing.quad)        Reanimated's own default: eases in and out
  //   Easing.out(Easing.cubic)         starts fast, slows gently into place
  //   Easing.in(Easing.cubic)          starts slow, ends fast
  //   Easing.out(Easing.back(2))       runs past its spot and comes back; higher runs further
  //   Easing.bounce                    bounces at the end like a dropped ball
  //   Easing.bezier(0.2, 0.9, 0.3, 1)  your own curve, the same numbers as CSS cubic-bezier
  // easing: Easing.out(Easing.cubic),
  easing: Easing.out(Easing.cubic),
  // How fast the spring's bounce dies down. Lower bounces longer; higher settles sooner.
  springDamping: 12,
  // How hard the spring pulls toward its spot. Higher is quicker and snappier.
  springStiffness: 120,
  // How heavy the row feels. Higher is slower and swings further.
  springMass: 1,
};

function buildRowSlide({
  style,
  durationMilliseconds,
  delayMilliseconds,
  easing,
  springDamping,
  springStiffness,
  springMass,
}: RowSlideKnobs) {
  if (style === 'spring') {
    return LinearTransition.springify()
      .damping(springDamping)
      .stiffness(springStiffness)
      .mass(springMass)
      .delay(delayMilliseconds);
  }
  if (style === 'curved') {
    return CurvedTransition.duration(durationMilliseconds).delay(delayMilliseconds);
  }
  return LinearTransition.duration(durationMilliseconds).easing(easing).delay(delayMilliseconds);
}

const rowSlideTransition = buildRowSlide(rowSlide);

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

// Taking a template off the list keeps the piece itself. Pieces pick counted prep through its
// template, so for counted prep the box says it leaves Add prep too.
function confirmRemoveTemplate(
  template: Template,
  removeTemplate: (templateId: number) => Promise<void>,
) {
  const addPrepLine =
    template.size_amount === null ? '' : " Pieces won't be able to pick it in Add prep anymore.";
  Alert.alert(`Remove ${template.name} from templates?`, `It stays in Pieces.${addPrepLine}`, [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Remove',
      style: 'destructive',
      onPress: () => removeTemplate(template.id).catch(showError('Could not remove the template')),
    },
  ]);
}

// What the panel after Done starts with: the prep and supplies already on it, then its
// template's (Decisions: Record once, then just make), and what can be added. A batch of a counted
// template takes no prep or supplies from it, since the template knows them.
async function loadFinishUses(piece: UnfinishedPiece) {
  const [availablePrep, usedPrep, availableSupplies, usedSupplies] = await Promise.all([
    getAvailablePrep(piece.id),
    getPiecePrep(piece.id),
    getAvailableSupplies(piece.id),
    getPieceSupplies(piece.id),
  ]);
  const template =
    piece.template_id === null
      ? null
      : await getTemplateUses(piece.template_id, piece.id, {
          prep: availablePrep,
          supplies: availableSupplies,
        });
  const prep = getTemplateChoices(
    piece.template_counted ? [] : (template?.prep ?? []),
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
    rename,
    removeTemplate,
    takeBreak,
    backToWork,
    endDay,
    stopRunning,
  } = useWorkStore();
  const { ref: startRef, measure: measureStart } = useGuideTarget('start');
  const setTabBarHeight = useGuideStore((state) => state.setTabBarHeight);
  const { bottom: bottomInset } = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [category, setCategory] = useState<PieceCategory>('piece');
  const [finishing, setFinishing] = useState<Finishing | null>(null);
  const [openingPieceId, setOpeningPieceId] = useState<number | null>(null);
  const [photographingPieceId, setPhotographingPieceId] = useState<number | null>(null);
  const [pickingStopFor, setPickingStopFor] = useState<RunningEntry | null>(null);
  const [renaming, setRenaming] = useState<UnfinishedPiece | null>(null);
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
  // The running piece is the list's first row, stuck to the top while it scrolls, so a long list
  // never hides it. The rest stay in the order they were started.
  const runningPiece = pieces.find((piece) => piece.running_since !== null);
  const pausedPieces = pieces.filter((piece) => piece.running_since === null);
  const listedPieces = runningPiece ? [runningPiece, ...pausedPieces] : pausedPieces;
  const runningPieceId = runningPiece?.id;
  const pieceListRef = useRef<ScrollViewInstance>(null);

  useEffect(() => setTabBarHeight(bottomInset), [bottomInset, setTabBarHeight]);

  // A new running piece takes the top row while the list may be scrolled, and the stuck row then
  // stays half under the template box until the list is scrolled back. Scrolling to the top puts
  // it in full view, where the tapped piece is going anyway.
  useEffect(() => {
    pieceListRef.current?.scrollTo({ y: 0, animated: true });
  }, [runningPieceId]);

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

  // The piece's clock keeps running through the panel; Save sets the finish time. The camera
  // never opens on its own: the photo is taken mid-work with Photo, or from the panel.
  async function openFinish(piece: UnfinishedPiece, lost: boolean) {
    setOpeningPieceId(piece.id);
    try {
      setFinishing({ piece, lost, cameraPhotoUri: null, ...(await loadFinishUses(piece)) });
    } finally {
      setOpeningPieceId(null);
    }
  }

  // Copied into the app's photos only when Save finishes the piece.
  function photographFinish() {
    takePhoto()
      .then((uri) => {
        if (uri) setFinishing((current) => current && { ...current, cameraPhotoUri: uri });
      })
      .catch(showError('Could not take the photo'));
  }

  // Swiping a row left shows what's needed mid-work besides swapping and Done.
  function renderPiece(piece: UnfinishedPiece) {
    const running = piece.running_since !== null;
    // Only the running piece has a clock to pause.
    const pauseActions: SwipeAction[] = running
      ? [
          {
            label: 'Pause',
            icon: 'pause.fill',
            onPress: () => endDay().catch(showError('Could not pause')),
          },
        ]
      : [];
    const actions: SwipeAction[] = [
      ...pauseActions,
      { label: 'Rename', icon: 'pencil', onPress: () => setRenaming(piece) },
      {
        label: 'Lost',
        icon: 'exclamationmark.triangle.fill',
        color: colors.warning,
        onPress: () => openFinish(piece, true).catch(showError('Could not open Done')),
      },
      {
        label: 'Delete',
        icon: 'trash.fill',
        color: colors.danger,
        onPress: () => confirmDelete(piece, remove),
      },
    ];

    // Rows slide to their new places when the running piece changes, so a tapped row is seen
    // moving to the top instead of jumping there.
    return (
      <Animated.View key={piece.id} layout={rowSlideTransition}>
        <SwipeRow actions={actions} containerStyle={styles.swipeRow}>
          <Pressable
            style={[
              styles.pieceRow,
              running &&
                (piece.category === 'prep' ? styles.prepRowCurrent : styles.pieceRowCurrent),
            ]}
            onPress={
              !running
                ? () => switchTo(piece.id).catch(showError('Could not switch pieces'))
                : undefined
            }
            onLongPress={() => confirmDelete(piece, remove)}
          >
            <View style={styles.nameRow}>
              <Text style={[styles.pieceName, running && styles.currentText]}>{piece.name}</Text>
              {piece.category === 'prep' && <Tag label="Prep" onFill={running} />}
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
              {running && (
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
                onPress={() => openFinish(piece, false).catch(showError('Could not open Done'))}
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
        </SwipeRow>
      </Animated.View>
    );
  }

  const finishPanel = finishing && (
    <FinishPiecePanel
      pieceName={finishing.piece.name}
      category={finishing.piece.category}
      initialLost={finishing.lost}
      initialNotes={finishing.piece.notes}
      photoUri={
        finishing.cameraPhotoUri ??
        (finishing.piece.photo_file_name ? getPhotoUri(finishing.piece.photo_file_name) : null)
      }
      // A photo taken mid-work is kept as it is; Retake for it is on the Work row.
      onTakePhoto={finishing.piece.photo_file_name ? undefined : photographFinish}
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
      onSave={(notes, lost, rating, isTemplate, prepUses, supplyUses, size) =>
        finish(finishing.piece.id, {
          notes,
          cameraPhotoUri: finishing.cameraPhotoUri,
          savedPhotoFileName: finishing.piece.photo_file_name,
          lost,
          rating,
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
          onPress={showGuide}
          accessibilityLabel="Show the guide"
        >
          <Text style={styles.helpButtonText}>?</Text>
        </Pressable>
      </View>
      <View ref={startRef} onLayout={measureStart} style={styles.startRow}>
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
          getSwipeActions={({ template }) => [
            {
              label: 'Remove',
              icon: 'minus.circle.fill',
              color: colors.danger,
              onPress: () => confirmRemoveTemplate(template, removeTemplate),
            },
          ]}
          floating
        />
      )}
      {runningEntry && (
        <StillWorkingQuestion
          entry={runningEntry}
          onPickTime={() => setPickingStopFor(runningEntry)}
        />
      )}

      <ScrollView
        ref={pieceListRef}
        style={styles.pieceList}
        contentContainerStyle={styles.pieceListContent}
        stickyHeaderIndices={runningPiece ? [0] : []}
      >
        {listedPieces.map(renderPiece)}
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
        {(runningPiece || runningBreak) && (
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
      {renaming && (
        <RenamePanel
          initialName={renaming.name}
          onCancel={() => setRenaming(null)}
          onSave={(newName) => rename(renaming.id, newName).then(() => setRenaming(null))}
        />
      )}
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
  // The rows' corners, so the swipe buttons behind them stay hidden there.
  swipeRow: {
    borderRadius: 12,
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
