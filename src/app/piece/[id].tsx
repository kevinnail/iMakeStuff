import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrepPickerPanel } from '@/components/PrepPickerPanel';
import { askPrepPercent } from '@/components/prepUsePrompts';
import { getPieceDetail, type PieceRecord } from '@/db/queries/pieceQueries';
import {
  addPrepUse,
  changePrepUse,
  getAvailablePrep,
  removePrepUse,
  type AvailablePrep,
  type PieceUsingPrep,
  type UsedPrep,
} from '@/db/queries/prepQueries';
import { formatClockTime, formatDay, formatDuration } from '@/utils/formatTime';
import { getPrepTime } from '@/utils/prepTime';
import { getWorkDays, type WorkDay } from '@/utils/workDays';
import { getPhotoUri } from '@/utils/photoStorage';
import { colors } from '@/theme';

interface PiecePage {
  piece: PieceRecord;
  days: WorkDay[];
  usedPrep: UsedPrep[];
  usedBy: PieceUsingPrep[];
}

type PrepTime = ReturnType<typeof getPrepTime<UsedPrep>>;

interface TotalsProps {
  days: WorkDay[];
  prepTime: PrepTime;
}

interface PrepUsedProps {
  pieceId: number;
  lines: PrepTime['lines'];
  onChange: () => Promise<void>;
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

function showError(title: string) {
  return (error: Error) => Alert.alert(title, error.message);
}

// The whole piece: its total time large (its own time plus its share of prep), when it was
// worked, then what the total is made of and where the rest of the time went.
function Totals({ days, prepTime }: TotalsProps) {
  const firstDay = days[0];
  const lastDay = days[days.length - 1];
  const when =
    days.length === 1
      ? `${formatDay(firstDay.dayStart)}, ${formatClockTime(firstDay.firstStart)} to ${formatClockTime(firstDay.lastStop)}`
      : `${formatDay(firstDay.dayStart)} to ${formatDay(lastDay.dayStart)}, ${days.length} days`;
  const usedPrep = prepTime.lines.length > 0;
  const prepRows = [
    { label: 'On the piece', milliseconds: sumDays(days, 'worked') },
    { label: 'Prep, estimated', milliseconds: prepTime.prep },
  ];
  const rows = [
    ...(usedPrep ? prepRows : []),
    { label: 'Break', milliseconds: sumDays(days, 'onBreak') },
    { label: 'Other pieces', milliseconds: sumDays(days, 'otherPieces') },
  ];

  return (
    <View style={styles.totals}>
      <Text style={styles.totalLine}>
        <Text style={styles.totalTime}>{formatDuration(prepTime.total)}</Text> total
        {usedPrep && ', estimated'}
      </Text>
      <Text style={styles.secondaryText}>{when}</Text>
      {rows.map(({ label, milliseconds }) => (
        <View key={label} style={styles.tableRow}>
          <Text style={styles.secondaryText}>{label}</Text>
          <Text style={styles.tableValue}>{formatDuration(milliseconds)}</Text>
        </View>
      ))}
    </View>
  );
}

// One line per day, so a piece worked over many days still fits on one screen.
function DayTable({ days }: { days: WorkDay[] }) {
  return (
    <View style={styles.dayTable}>
      <View style={styles.tableRow}>
        <Text style={[styles.secondaryText, styles.dayColumn]}>Day</Text>
        {dayColumns.map(({ label, width }) => (
          <Text key={label} style={[styles.secondaryText, styles.numberColumn, { width }]}>
            {label}
          </Text>
        ))}
      </View>
      {days.map((day) => (
        <View key={day.dayStart} style={styles.tableRow}>
          <Text style={[styles.tableValue, styles.dayColumn]}>{formatDay(day.dayStart)}</Text>
          {dayColumns.map(({ field, width }) => (
            <Text key={field} style={[styles.tableValue, styles.numberColumn, { width }]}>
              {formatDuration(day[field])}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

function PrepUsed({ pieceId, lines, onChange }: PrepUsedProps) {
  const [prepList, setPrepList] = useState<AvailablePrep[] | null>(null);

  function save(change: Promise<void>) {
    change.then(onChange).catch(showError('Could not save the prep'));
  }

  function openPrepList() {
    getAvailablePrep(pieceId).then(setPrepList).catch(showError('Could not load your prep'));
  }

  function addPrep(chosenPrep: AvailablePrep, estimatedPercent: number) {
    setPrepList(null);
    save(addPrepUse(pieceId, { prepId: chosenPrep.id, estimatedPercent }));
  }

  function changeUse(use: UsedPrep) {
    askPrepPercent({
      prepName: use.prep_name,
      currentPercent: use.estimated_percent,
      onSave: (estimatedPercent) => save(changePrepUse(use.id, estimatedPercent)),
      onRemove: () => save(removePrepUse(use.id)),
    });
  }

  return (
    <View style={styles.totals}>
      <View style={styles.tableRow}>
        <Text style={styles.cardTitle}>Prep used</Text>
        <Pressable
          style={({ pressed }) => [styles.addPrepButton, pressed && styles.buttonPressed]}
          onPress={openPrepList}
        >
          <Text style={styles.buttonText}>Add prep</Text>
        </Pressable>
      </View>
      {prepList && (
        <PrepPickerPanel prepList={prepList} onCancel={() => setPrepList(null)} onAdd={addPrep} />
      )}
      {lines.map((line) => (
        <Pressable key={line.id} style={styles.tableRow} onPress={() => changeUse(line)}>
          <Text style={[styles.tableValue, styles.dayColumn]}>{line.prep_name}</Text>
          <Text style={styles.tableValue}>{line.estimated_percent}%</Text>
          <Text style={[styles.tableValue, styles.numberColumn, styles.prepTimeColumn]}>
            {formatDuration(line.milliseconds)}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

// A prep's uses: the total so far, then each piece that used it.
function UsedBy({ usedBy }: { usedBy: PieceUsingPrep[] }) {
  const usedSoFar = usedBy.reduce((total, use) => total + use.estimated_percent, 0);

  return (
    <View style={styles.totals}>
      <View style={styles.tableRow}>
        <Text style={styles.cardTitle}>Used so far</Text>
        <Text style={styles.tableValue}>{usedSoFar}%</Text>
      </View>
      {usedBy.map((use) => (
        <Pressable
          key={use.id}
          style={styles.tableRow}
          onPress={() => router.push({ pathname: '/piece/[id]', params: { id: use.piece_id } })}
        >
          <Text style={[styles.tableValue, styles.dayColumn]}>{use.piece_name}</Text>
          <Text style={styles.tableValue}>{use.estimated_percent}%</Text>
        </Pressable>
      ))}
    </View>
  );
}

export default function PieceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pieceId = Number(id);
  // undefined while loading, null when no piece has this id.
  const [page, setPage] = useState<PiecePage | null>();
  const [photoAspectRatio, setPhotoAspectRatio] = useState(3 / 4);

  const load = useCallback(
    () =>
      getPieceDetail(pieceId).then((detail) =>
        setPage(
          detail && {
            piece: detail.piece,
            days: getWorkDays(detail.segments, detail.otherSegments, detail.breaks, Date.now()),
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

  const { piece, days, usedPrep, usedBy } = page;
  const prepTime = getPrepTime(sumDays(days, 'worked'), usedPrep);
  return (
    // The iOS header is see-through, so the content has to be inset below it.
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.page}>
      <Stack.Screen options={{ title: piece.name }} />
      {piece.photo_file_name && (
        <Image
          source={{ uri: getPhotoUri(piece.photo_file_name) }}
          style={[styles.photo, { aspectRatio: photoAspectRatio }]}
          onLoad={({ nativeEvent }) =>
            setPhotoAspectRatio(nativeEvent.source.width / nativeEvent.source.height)
          }
        />
      )}
      {!piece.finished_at && <Text style={styles.text}>Unfinished</Text>}
      {piece.notes && <Text style={styles.text}>{piece.notes}</Text>}
      <Totals days={days} prepTime={prepTime} />
      {days.length > 1 && <DayTable days={days} />}
      {piece.category === 'piece' ? (
        <PrepUsed pieceId={piece.id} lines={prepTime.lines} onChange={load} />
      ) : (
        <UsedBy usedBy={usedBy} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    padding: 16,
    gap: 12,
  },
  photo: {
    width: '100%',
    borderRadius: 8,
  },
  text: {
    fontSize: 18,
    color: colors.text,
  },
  totals: {
    padding: 16,
    gap: 8,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  tableRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 8,
  },
  dayTable: {
    gap: 6,
  },
  dayColumn: {
    flex: 1,
  },
  numberColumn: {
    textAlign: 'right',
  },
  prepTimeColumn: {
    width: 76,
  },
  cardTitle: {
    fontSize: 18,
    color: colors.text,
  },
  addPrepButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 8,
  },
  buttonPressed: {
    opacity: 0.6,
  },
  buttonText: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.text,
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
