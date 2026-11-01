import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { getWorkRecords, type FinishedPiece } from '@/db/queries/dayQueries';
import { formatClockTime, formatDay, formatDuration } from '@/utils/formatTime';
import { getPhotoUri } from '@/utils/photoStorage';
import { getWorkDays, startOfDay, type WorkDay } from '@/utils/workDays';

interface DaySummary {
  day: WorkDay;
  finishedPieces: FinishedPiece[];
}

export default function DaysScreen() {
  const [days, setDays] = useState<DaySummary[]>([]);

  // Reloads every time the tab is shown, so today's numbers are current.
  useFocusEffect(
    useCallback(() => {
      getWorkRecords(new Date(0).toISOString())
        .then(({ segments, breaks, finishedPieces }) =>
          setDays(
            getWorkDays(segments, [], breaks, Date.now())
              .reverse()
              .map((day) => ({
                day,
                finishedPieces: finishedPieces.filter(
                  (piece) => startOfDay(Date.parse(piece.finished_at)) === day.dayStart,
                ),
              })),
          ),
        )
        .catch((error: Error) => Alert.alert('Could not load your days', error.message));
    }, []),
  );

  return (
    <FlatList
      data={days}
      keyExtractor={({ day }) => String(day.dayStart)}
      contentContainerStyle={styles.list}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      renderItem={({ item: { day, finishedPieces } }) => (
        <View style={styles.day}>
          <View style={styles.dayHeader}>
            <Text style={styles.date}>{formatDay(day.dayStart)}</Text>
            <Text style={styles.worked}>{formatDuration(day.worked)}</Text>
          </View>
          <View style={styles.dayHeader}>
            <Text style={styles.secondaryText}>
              {formatClockTime(day.firstStart)} to {formatClockTime(day.lastStop)}
            </Text>
            <Text style={styles.secondaryText}>Break {formatDuration(day.onBreak)}</Text>
          </View>
          {finishedPieces.map((piece) => (
            <Pressable
              key={piece.id}
              style={styles.pieceRow}
              onPress={() => router.push({ pathname: '/piece/[id]', params: { id: piece.id } })}
            >
              {piece.photo_file_name ? (
                <Image source={{ uri: getPhotoUri(piece.photo_file_name) }} style={styles.photo} />
              ) : (
                <View style={styles.photo} />
              )}
              <Text style={styles.pieceName}>{piece.name}</Text>
            </Pressable>
          ))}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    padding: 16,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 12,
    backgroundColor: '#ccc',
  },
  day: {
    gap: 6,
  },
  dayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  date: {
    fontSize: 20,
    fontWeight: '600',
  },
  worked: {
    fontSize: 20,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  secondaryText: {
    fontSize: 16,
    color: '#555',
  },
  pieceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  photo: {
    width: 40,
    height: 40,
    borderRadius: 6,
    backgroundColor: '#eee',
  },
  pieceName: {
    flex: 1,
    fontSize: 16,
  },
});
