import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { getWorkRecords, type FinishedPiece } from '@/db/queries/dayQueries';
import { formatClockTime, formatDay, formatDuration } from '@/utils/formatTime';
import { getMonthWeeks } from '@/utils/monthGrid';
import { getPhotoUri } from '@/utils/photoStorage';
import { getWorkDays, startOfDay, type WorkDay } from '@/utils/workDays';

interface DaySummary {
  day: WorkDay;
  finishedPieces: FinishedPiece[];
}

interface MonthCalendarProps {
  monthStart: number;
  today: number;
  workedDayStarts: Set<number>;
  onChangeMonth: (monthStart: number) => void;
}

const weekdayInitials = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function openDay(dayStart: number) {
  router.push({ pathname: '/day/[dayStart]', params: { dayStart } });
}

function MonthCalendar({ monthStart, today, workedDayStarts, onChangeMonth }: MonthCalendarProps) {
  const shown = new Date(monthStart);
  const year = shown.getFullYear();
  const month = shown.getMonth();
  const isCurrentMonth =
    new Date(today).getFullYear() === year && new Date(today).getMonth() === month;
  const previousMonthStart = new Date(year, month - 1, 1).getTime();
  const nextMonthStart = new Date(year, month + 1, 1).getTime();

  const swipe = PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_event, { dx, dy }) =>
      Math.abs(dx) > 20 && Math.abs(dx) > Math.abs(dy) * 2,
    onPanResponderRelease: (_event, { dx }) => {
      if (dx > 50) onChangeMonth(previousMonthStart);
      else if (dx < -50 && !isCurrentMonth) onChangeMonth(nextMonthStart);
    },
  });

  return (
    <View style={styles.calendar} {...swipe.panHandlers}>
      <View style={styles.monthRow}>
        <Pressable style={styles.arrowButton} onPress={() => onChangeMonth(previousMonthStart)}>
          <Text style={styles.arrowText}>‹</Text>
        </Pressable>
        <Text style={styles.monthTitle}>
          {shown.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </Text>
        <Pressable
          style={[styles.arrowButton, isCurrentMonth && styles.arrowHidden]}
          onPress={() => onChangeMonth(nextMonthStart)}
          disabled={isCurrentMonth}
        >
          <Text style={styles.arrowText}>›</Text>
        </Pressable>
      </View>
      <View style={styles.week}>
        {weekdayInitials.map((initial, index) => (
          <Text key={index} style={styles.weekdayInitial}>
            {initial}
          </Text>
        ))}
      </View>
      {getMonthWeeks(year, month).map((week, weekIndex) => (
        <View key={weekIndex} style={styles.week}>
          {week.map((dayOfMonth, index) => {
            if (dayOfMonth === null) return <View key={index} style={styles.square} />;
            const dayStart = new Date(year, month, dayOfMonth).getTime();
            const worked = workedDayStarts.has(dayStart);
            return (
              <Pressable
                key={index}
                style={[
                  styles.square,
                  worked && styles.workedSquare,
                  dayStart === today && styles.todaySquare,
                ]}
                onPress={() => openDay(dayStart)}
                disabled={!worked}
              >
                <Text style={[styles.dayNumber, worked && styles.workedDayNumber]}>
                  {dayOfMonth}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

export default function DaysScreen() {
  const [days, setDays] = useState<DaySummary[]>([]);
  // Set when the tab loads, so the calendar marks the right day after midnight.
  const [today, setToday] = useState(() => startOfDay(Date.now()));
  const [monthStart, setMonthStart] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  });
  const shownMonth = new Date(monthStart);
  const monthEnd = new Date(shownMonth.getFullYear(), shownMonth.getMonth() + 1, 1).getTime();
  const monthDays = days.filter(({ day }) => day.dayStart >= monthStart && day.dayStart < monthEnd);
  const workedDayStarts = new Set(monthDays.map(({ day }) => day.dayStart));

  // Reloads every time the tab is shown, so today's numbers are current.
  useFocusEffect(
    useCallback(() => {
      getWorkRecords(new Date(0).toISOString())
        .then(({ segments, breaks, finishedPieces }) => {
          setToday(startOfDay(Date.now()));
          setDays(
            getWorkDays(segments, [], breaks, Date.now())
              .reverse()
              .map((day) => ({
                day,
                finishedPieces: finishedPieces.filter(
                  (piece) => startOfDay(Date.parse(piece.finished_at)) === day.dayStart,
                ),
              })),
          );
        })
        .catch((error: Error) => Alert.alert('Could not load your days', error.message));
    }, []),
  );

  return (
    <FlatList
      data={monthDays}
      keyExtractor={({ day }) => String(day.dayStart)}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.list}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListHeaderComponent={
        <>
          <MonthCalendar
            monthStart={monthStart}
            today={today}
            workedDayStarts={workedDayStarts}
            onChangeMonth={setMonthStart}
          />
          <View style={styles.sectionDivider} />
          <View style={styles.sectionRow}>
            <Text style={styles.listTitle}>Days worked</Text>
            <Pressable
              style={({ pressed }) => [styles.addButton, pressed && styles.buttonPressed]}
              onPress={() => router.push('/add-work')}
            >
              <Text style={styles.addButtonText}>Add past work</Text>
            </Pressable>
          </View>
        </>
      }
      ListEmptyComponent={<Text style={styles.secondaryText}>Nothing recorded this month.</Text>}
      ListHeaderComponentStyle={styles.listHeader}
      renderItem={({ item: { day, finishedPieces } }) => (
        <View style={styles.day}>
          <Pressable style={styles.day} onPress={() => openDay(day.dayStart)}>
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
          </Pressable>
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
  listHeader: {
    gap: 16,
    paddingBottom: 12,
  },
  // The line between the calendar and the list of days.
  sectionDivider: {
    height: 1,
    backgroundColor: '#c4c4c4',
  },
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  addButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#1a1a1a',
  },
  buttonPressed: {
    opacity: 0.6,
  },
  addButtonText: {
    fontSize: 16,
    lineHeight: 18,
    color: '#fff',
  },
  calendar: {
    gap: 4,
  },
  monthRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  monthTitle: {
    fontSize: 20,
    fontWeight: '600',
  },
  arrowButton: {
    paddingVertical: 4,
    paddingHorizontal: 16,
  },
  arrowHidden: {
    opacity: 0,
  },
  arrowText: {
    fontSize: 32,
    lineHeight: 34,
  },
  week: {
    flexDirection: 'row',
    gap: 4,
  },
  weekdayInitial: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    color: '#555',
  },
  square: {
    flex: 1,
    aspectRatio: 1,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 6,
  },
  workedSquare: {
    backgroundColor: '#2e7d32',
  },
  todaySquare: {
    borderWidth: 2,
    borderColor: '#1a1a1a',
  },
  dayNumber: {
    fontSize: 16,
    color: '#555',
  },
  workedDayNumber: {
    color: '#fff',
    fontWeight: '600',
  },
  listTitle: {
    fontSize: 16,
    fontWeight: '600',
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
