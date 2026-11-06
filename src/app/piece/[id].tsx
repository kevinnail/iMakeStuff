import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { Card } from '@/components/Card';
import { Chevron } from '@/components/Chevron';
import { EntryTimesPanel } from '@/components/EntryTimesPanel';
import { PieceEditForm } from '@/components/PieceEditForm';
import { PrepLeftBar } from '@/components/PrepLeftBar';
import { PrepUsePanel, type PrepUseChoice } from '@/components/PrepUsePanel';
import { Tag } from '@/components/Tag';
import { addPieceTime } from '@/db/queries/entryQueries';
import {
  getPieceDetail,
  setPieceLost,
  setPieceTemplate,
  type PieceRecord,
} from '@/db/queries/pieceQueries';
import {
  addPrepUse,
  changePrepUse,
  getAvailablePrep,
  removePrepUse,
  setPrepUsedUp,
  type AvailablePrep,
  type PieceUsingPrep,
  type UsedPrep,
} from '@/db/queries/prepQueries';
import { formatClockTime, formatDay, formatDuration } from '@/utils/formatTime';
import {
  formatPercent,
  formatShare,
  getActualShare,
  getPrepTime,
  getShareValue,
  usesUpPrep,
} from '@/utils/prepTime';
import { getWorkDays, type WorkDay } from '@/utils/workDays';
import { getPhotoUri } from '@/utils/photoStorage';
import { colors } from '@/theme';
import { showError } from '@/utils/showError';

interface PiecePage {
  piece: PieceRecord;
  days: WorkDay[];
  // When the running piece or break started, or null with nothing running.
  runningSince: string | null;
  usedPrep: UsedPrep[];
  usedBy: PieceUsingPrep[];
}

type PrepTime = ReturnType<typeof getPrepTime<UsedPrep>>;

type PrepLine = PrepTime['lines'][number];

interface TotalsProps {
  days: WorkDay[];
  prepTime: PrepTime;
  // Unfinished or Lost, beside the total.
  tag: string | null;
}

interface PrepUsedProps {
  pieceId: number;
  lines: PrepLine[];
  onChange: () => Promise<void>;
}

interface UsedByProps {
  usedBy: PieceUsingPrep[];
  usedUp: boolean;
}

type DayField = 'worked' | 'otherPieces' | 'onBreak';

const dayColumns: { label: string; field: DayField; width: number }[] = [
  { label: 'Worked', field: 'worked', width: 76 },
  { label: 'Break', field: 'onBreak', width: 60 },
  { label: 'Other pieces', field: 'otherPieces', width: 124 },
];

function sumDays(days: WorkDay[], field: DayField) {
  return days.reduce((total, day) => total + day[field], 0);
}

// Add time starts on the hour just past, the likeliest stretch to have gone unrecorded. With
// something running, the hour ends where it started, so it doesn't overlap it.
function getLastHour(runningSince: string | null) {
  const endedAt = runningSince ? Date.parse(runningSince) : Date.now();
  return { startedAt: endedAt - 60 * 60 * 1000, endedAt };
}

// The whole piece: its total time large (its own time plus its share of prep), when it was
// worked, then a card of what the total is made of and where the rest of the time went. A piece
// whose only entry ended at its own start (I stopped at, or a time fix) has no days, so no when.
function Totals({ days, prepTime, tag }: TotalsProps) {
  const firstDay = days[0];
  const lastDay = days[days.length - 1];
  const when =
    days.length === 0
      ? null
      : days.length === 1
        ? `${formatDay(firstDay.dayStart)}, ${formatClockTime(firstDay.firstStart)} to ${formatClockTime(firstDay.lastStop)}`
        : `${formatDay(firstDay.dayStart)} to ${formatDay(lastDay.dayStart)}, ${days.length} days`;
  const usedPrep = prepTime.lines.length > 0;
  const prepRows = [
    { label: 'On the piece', milliseconds: sumDays(days, 'worked') },
    { label: prepTime.estimated ? 'Prep, estimated' : 'Prep', milliseconds: prepTime.prep },
  ];
  const rows = [
    ...(usedPrep ? prepRows : []),
    { label: 'Break', milliseconds: sumDays(days, 'onBreak') },
    { label: 'Other pieces', milliseconds: sumDays(days, 'otherPieces') },
  ];

  return (
    <>
      <View style={styles.totalHeader}>
        <View style={styles.inlineRow}>
          <Text style={[styles.totalLine, styles.fill]}>
            <Text style={styles.totalTime}>{formatDuration(prepTime.total)}</Text> total
            {prepTime.estimated && ', estimated'}
          </Text>
          {tag && <Tag label={tag} />}
        </View>
        {when && <Text style={styles.secondaryText}>{when}</Text>}
      </View>
      <Card>
        {rows.map(({ label, milliseconds }) => (
          <View key={label} style={styles.row}>
            <Text style={[styles.text, styles.fill]}>{label}</Text>
            <Text style={styles.value}>{formatDuration(milliseconds)}</Text>
          </View>
        ))}
      </Card>
    </>
  );
}

// One line per day, so a piece worked over many days still fits on one screen.
function DayTable({ days }: { days: WorkDay[] }) {
  return (
    <Card>
      <View style={styles.row}>
        <Text style={[styles.secondaryText, styles.fill]}>Day</Text>
        {dayColumns.map(({ label, width }) => (
          <Text key={label} style={[styles.secondaryText, styles.numberColumn, { width }]}>
            {label}
          </Text>
        ))}
      </View>
      {days.map((day) => (
        <View key={day.dayStart} style={styles.row}>
          <Text style={[styles.tableValue, styles.fill]}>{formatDay(day.dayStart)}</Text>
          {dayColumns.map(({ field, width }) => (
            <Text key={field} style={[styles.tableValue, styles.numberColumn, { width }]}>
              {formatDuration(day[field])}
            </Text>
          ))}
        </View>
      ))}
    </Card>
  );
}

// The heading, then the prep as one card: a row per prep with its share and time, tapped to
// change or remove it, and Add prep as the last row, the same as Prep used on Add Work.
function PrepUsed({ pieceId, lines, onChange }: PrepUsedProps) {
  const [prepList, setPrepList] = useState<AvailablePrep[] | null>(null);
  const [changingLine, setChangingLine] = useState<PrepLine | null>(null);

  function save(change: Promise<void>) {
    setPrepList(null);
    setChangingLine(null);
    change.then(onChange).catch(showError('Could not save the prep'));
  }

  function openPrepList() {
    getAvailablePrep(pieceId).then(setPrepList).catch(showError('Could not load your prep'));
  }

  function addPrep({ prep, share }: PrepUseChoice) {
    save(addPrepUse(pieceId, { prepId: prep.id, share }));
  }

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>Prep used</Text>
      <Card>
        {lines.length === 0 && (
          <View style={styles.row}>
            <Text style={styles.secondaryText}>No prep added</Text>
          </View>
        )}
        {lines.map((line) => (
          <Pressable
            key={line.id}
            style={({ pressed }) => [styles.row, pressed && styles.buttonPressed]}
            onPress={() => setChangingLine(line)}
          >
            <View style={styles.fill}>
              <Text style={styles.text}>{line.prep_name}</Text>
              <Text style={styles.note}>{line.estimated ? 'Estimated' : 'Used up'}</Text>
            </View>
            <Text style={styles.value}>
              {line.estimated ? formatShare(line) : formatPercent(line.share)}
            </Text>
            <Text style={[styles.value, styles.numberColumn, styles.prepTimeColumn]}>
              {formatDuration(line.milliseconds)}
            </Text>
            <Chevron />
          </Pressable>
        ))}
        <Pressable
          style={({ pressed }) => [styles.row, pressed && styles.buttonPressed]}
          onPress={openPrepList}
        >
          <Text style={styles.addText}>Add prep</Text>
        </Pressable>
      </Card>
      {prepList && (
        <PrepUsePanel
          prepList={prepList}
          initial={null}
          onCancel={() => setPrepList(null)}
          onSave={addPrep}
        />
      )}
      {changingLine && (
        <PrepUsePanel
          prepList={null}
          initial={{
            prep: {
              id: changingLine.prep_id,
              name: changingLine.prep_name,
              otherPiecesShare: changingLine.shares_total - getShareValue(changingLine),
              usedUp: changingLine.prep_used_up === 1,
            },
            share: {
              share_numerator: changingLine.share_numerator,
              share_denominator: changingLine.share_denominator,
            },
          }}
          onCancel={() => setChangingLine(null)}
          onSave={({ share }) => save(changePrepUse(changingLine.id, share))}
          onRemove={() => save(removePrepUse(changingLine.id))}
        />
      )}
    </View>
  );
}

// A prep's uses: each piece's estimate, and once the prep is used up, what it really took.
function UsedBy({ usedBy, usedUp }: UsedByProps) {
  const rows = usedBy.map((use) => ({ ...use, actual_share: getActualShare(use) }));
  const estimatedTotal = rows.reduce((total, row) => total + getShareValue(row), 0);
  const actualTotal = rows.reduce((total, row) => total + row.actual_share, 0);

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>Used by</Text>
      {rows.length === 0 ? (
        <Card>
          <View style={styles.row}>
            <Text style={styles.secondaryText}>No pieces have used it yet.</Text>
          </View>
        </Card>
      ) : (
        <Card>
          <View style={styles.row}>
            <Text style={[styles.secondaryText, styles.fill]}>Piece</Text>
            <Text style={[styles.secondaryText, styles.numberColumn, styles.estimatedColumn]}>
              Estimated
            </Text>
            {usedUp && (
              <Text style={[styles.secondaryText, styles.numberColumn, styles.actualColumn]}>
                Actual
              </Text>
            )}
            <View style={styles.chevronColumn} />
          </View>
          {rows.map((row) => (
            <Pressable
              key={row.id}
              style={({ pressed }) => [styles.row, pressed && styles.buttonPressed]}
              onPress={() => router.push({ pathname: '/piece/[id]', params: { id: row.piece_id } })}
            >
              <Text style={[styles.tableValue, styles.fill]}>{row.piece_name}</Text>
              <Text style={[styles.tableValue, styles.numberColumn, styles.estimatedColumn]}>
                {formatShare(row)}
              </Text>
              {usedUp && (
                <Text style={[styles.tableValue, styles.numberColumn, styles.actualColumn]}>
                  {formatPercent(row.actual_share)}
                </Text>
              )}
              <View style={styles.chevronColumn}>
                <Chevron />
              </View>
            </Pressable>
          ))}
          <View style={styles.row}>
            <Text style={[styles.secondaryText, styles.fill]}>Total</Text>
            <Text style={[styles.tableValue, styles.numberColumn, styles.estimatedColumn]}>
              {formatPercent(estimatedTotal)}
            </Text>
            {usedUp && (
              <Text style={[styles.tableValue, styles.numberColumn, styles.actualColumn]}>
                {formatPercent(actualTotal)}
              </Text>
            )}
            <View style={styles.chevronColumn} />
          </View>
        </Card>
      )}
    </View>
  );
}

export default function PieceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pieceId = Number(id);
  // undefined while loading, null when no piece has this id.
  const [page, setPage] = useState<PiecePage | null>();
  const [photoAspectRatio, setPhotoAspectRatio] = useState(3 / 4);
  const [editing, setEditing] = useState(false);
  const [addingTime, setAddingTime] = useState<{ startedAt: number; endedAt: number } | null>(null);

  const load = useCallback(
    () =>
      getPieceDetail(pieceId).then((detail) =>
        setPage(
          detail && {
            piece: detail.piece,
            days: getWorkDays(detail.segments, detail.otherSegments, detail.breaks, Date.now()),
            runningSince:
              [...detail.segments, ...detail.otherSegments, ...detail.breaks].find(
                (entry) => entry.ended_at === null,
              )?.started_at ?? null,
            usedPrep: detail.usedPrep,
            usedBy: detail.usedBy,
          },
        ),
      ),
    [pieceId],
  );

  // Reloads whenever the page is shown, so a use changed on a piece opened from here shows.
  useFocusEffect(
    useCallback(() => {
      load().catch(showError('Could not load the piece'));
    }, [load]),
  );

  if (page === undefined) return null;
  if (page === null) return <Text style={styles.text}>No piece with this id.</Text>;

  const { piece, days, runningSince, usedPrep, usedBy } = page;
  const prepTime = getPrepTime(sumDays(days, 'worked'), usedPrep);
  const finishedPrep = piece.category === 'prep' && piece.finished_at !== null;
  const usedShare = usedBy.reduce((total, use) => total + getShareValue(use), 0);
  const usedUp = piece.used_up_at !== null || usesUpPrep(usedShare);

  async function saveAddedTime(startedAt: number, endedAt: number | null) {
    await addPieceTime(
      piece.id,
      new Date(startedAt).toISOString(),
      new Date(endedAt!).toISOString(),
    );
    setAddingTime(null);
    await load();
  }

  function setLost(lost: boolean) {
    setPieceLost(piece.id, lost).then(load).catch(showError('Could not save the piece'));
  }

  function setTemplate(isTemplate: boolean) {
    setPieceTemplate(piece.id, isTemplate).then(load).catch(showError('Could not save the piece'));
  }

  function setUsedUp(value: boolean) {
    setPrepUsedUp(piece.id, value).then(load).catch(showError('Could not save the prep'));
  }

  if (editing) {
    return (
      <PieceEditForm
        piece={piece}
        worked={sumDays(days, 'worked')}
        usedByCount={usedBy.length}
        onCancel={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          load().catch(showError('Could not load the piece'));
        }}
        onDeleted={() => router.back()}
      />
    );
  }

  return (
    // The iOS header is see-through, so the content has to be inset below it.
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.page}>
      <Stack.Screen
        options={{
          title: piece.name,
          headerLeft: undefined,
          headerRight: () => (
            <Pressable
              style={({ pressed }) => [styles.editButton, pressed && styles.buttonPressed]}
              onPress={() => setEditing(true)}
            >
              <Text style={styles.editButtonText}>Edit</Text>
            </Pressable>
          ),
        }}
      />
      <Totals
        days={days}
        prepTime={prepTime}
        tag={!piece.finished_at ? 'Unfinished' : piece.lost ? 'Lost' : null}
      />
      {/* The rows that change the piece: a finished prep's Used up and what's left of it, a
          finished piece's switches, then Add time. */}
      <Card>
        {finishedPrep && (
          <View style={styles.row}>
            <Text style={[styles.text, styles.fill]}>Used up</Text>
            <Switch
              value={usedUp}
              onValueChange={setUsedUp}
              trackColor={{ true: colors.primary }}
            />
          </View>
        )}
        {finishedPrep && !piece.lost && (
          <View style={styles.row}>
            <View style={styles.fill}>
              <PrepLeftBar usedShare={usedShare} usedUp={usedUp} />
            </View>
          </View>
        )}
        {piece.finished_at && (
          <View style={styles.row}>
            <Text style={[styles.text, styles.fill]}>Use as template</Text>
            <Switch
              value={piece.is_template === 1}
              onValueChange={setTemplate}
              trackColor={{ true: colors.primary }}
            />
          </View>
        )}
        {piece.finished_at && (
          <View style={styles.row}>
            <Text style={[styles.text, styles.fill]}>Lost</Text>
            <Switch
              value={piece.lost === 1}
              onValueChange={setLost}
              trackColor={{ true: colors.primary }}
            />
          </View>
        )}
        <Pressable
          style={({ pressed }) => [styles.row, pressed && styles.buttonPressed]}
          onPress={() => setAddingTime(getLastHour(runningSince))}
        >
          <Text style={[styles.text, styles.fill]}>Add time</Text>
          <Chevron />
        </Pressable>
      </Card>
      {piece.category === 'piece' ? (
        <PrepUsed pieceId={piece.id} lines={prepTime.lines} onChange={load} />
      ) : (
        <UsedBy usedBy={usedBy} usedUp={usedUp} />
      )}
      {days.length > 1 && <DayTable days={days} />}
      {piece.notes && (
        <Card>
          <Text style={[styles.text, styles.notes]}>{piece.notes}</Text>
        </Card>
      )}
      {piece.photo_file_name && (
        <Image
          source={{ uri: getPhotoUri(piece.photo_file_name) }}
          style={[styles.photo, { aspectRatio: photoAspectRatio }]}
          onLoad={({ nativeEvent }) =>
            setPhotoAspectRatio(nativeEvent.source.width / nativeEvent.source.height)
          }
        />
      )}
      {addingTime && (
        <EntryTimesPanel
          title={`Add time to ${piece.name}`}
          initialStartedAt={addingTime.startedAt}
          initialEndedAt={addingTime.endedAt}
          onCancel={() => setAddingTime(null)}
          onSave={saveAddedTime}
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    padding: 16,
    gap: 16,
  },
  photo: {
    width: '100%',
    borderRadius: 8,
  },
  // A group of rows, the same as Add Work's cards.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  fill: {
    flex: 1,
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  section: {
    gap: 8,
  },
  heading: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
  },
  totalHeader: {
    gap: 4,
  },
  text: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.text,
  },
  notes: {
    paddingVertical: 12,
  },
  note: {
    fontSize: 16,
    color: colors.secondaryText,
  },
  value: {
    fontSize: 18,
    lineHeight: 20,
    fontVariant: ['tabular-nums'],
    color: colors.text,
  },
  addText: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.primary,
  },
  numberColumn: {
    textAlign: 'right',
  },
  prepTimeColumn: {
    width: 76,
  },
  estimatedColumn: {
    width: 90,
  },
  actualColumn: {
    width: 70,
  },
  chevronColumn: {
    width: 12,
  },
  editButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  editButtonText: {
    fontSize: 16,
    lineHeight: 18,
    color: colors.textOnFill,
  },
  buttonPressed: {
    opacity: 0.6,
  },
  totalLine: {
    fontSize: 18,
    color: colors.text,
  },
  totalTime: {
    fontSize: 32,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  secondaryText: {
    fontSize: 16,
    color: colors.secondaryText,
  },
  tableValue: {
    fontSize: 16,
    fontVariant: ['tabular-nums'],
    color: colors.text,
  },
});
