import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Image, ScrollView, StyleSheet, Text, View } from 'react-native';

import { getPieceDetail, type PieceRecord } from '@/db/queries/pieceQueries';
import { formatClockTime, formatDay, formatDuration } from '@/utils/formatTime';
import { getWorkDays, type WorkDay } from '@/utils/workDays';
import { getPhotoUri } from '@/utils/photoStorage';

interface PiecePage {
  piece: PieceRecord;
  days: WorkDay[];
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

// The whole piece: worked time large, when it was worked, then where the rest of the
// time went.
function Totals({ days }: { days: WorkDay[] }) {
  const firstDay = days[0];
  const lastDay = days[days.length - 1];
  const when =
    days.length === 1
      ? `${formatDay(firstDay.dayStart)}, ${formatClockTime(firstDay.firstStart)} to ${formatClockTime(firstDay.lastStop)}`
      : `${formatDay(firstDay.dayStart)} to ${formatDay(lastDay.dayStart)}, ${days.length} days`;
  const timeOff = [
    { label: 'Break', milliseconds: sumDays(days, 'onBreak') },
    { label: 'Other pieces', milliseconds: sumDays(days, 'otherPieces') },
  ];

  return (
    <View style={styles.totals}>
      <Text style={styles.workedLine}>
        <Text style={styles.workedTime}>{formatDuration(sumDays(days, 'worked'))}</Text> worked
      </Text>
      <Text style={styles.secondaryText}>{when}</Text>
      {timeOff.map(({ label, milliseconds }) => (
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

export default function PieceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // undefined while loading, null when no piece has this id.
  const [page, setPage] = useState<PiecePage | null>();
  const [photoAspectRatio, setPhotoAspectRatio] = useState(3 / 4);

  useEffect(() => {
    getPieceDetail(Number(id))
      .then((detail) =>
        setPage(
          detail && {
            piece: detail.piece,
            days: getWorkDays(detail.segments, detail.otherSegments, detail.breaks, Date.now()),
          },
        ),
      )
      .catch((error: Error) => Alert.alert('Could not load the piece', error.message));
  }, [id]);

  if (page === undefined) return null;
  if (page === null) return <Text style={styles.text}>No piece with this id.</Text>;

  const { piece, days } = page;
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
      <Totals days={days} />
      {days.length > 1 && <DayTable days={days} />}
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
  },
  totals: {
    padding: 16,
    gap: 8,
    borderRadius: 12,
    backgroundColor: '#f2f2f2',
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
  workedLine: {
    fontSize: 18,
  },
  workedTime: {
    fontSize: 32,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  secondaryText: {
    fontSize: 16,
    color: '#555',
  },
  tableValue: {
    fontSize: 16,
    fontVariant: ['tabular-nums'],
  },
});
