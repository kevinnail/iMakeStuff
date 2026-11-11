import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Chevron } from '@/components/Chevron';
import { DayTicks } from '@/components/DayTicks';
import { EntryTimesPanel } from '@/components/EntryTimesPanel';
import { getDayCost, type DayCost } from '@/db/queries/dayQueries';
import {
  addBreak,
  getDayEntries,
  type DayEntry,
  type TimelineEntry,
} from '@/db/queries/entryQueries';
import { useWorkStore } from '@/store/workStore';
import { colors } from '@/theme';
import { formatCost } from '@/utils/cost';
import { getDayTicks } from '@/utils/dayTicks';
import { formatClockTime, formatDay, formatDuration } from '@/utils/formatTime';
import { getWholeDays, startOfNextDay, type TimeRange, type WorkDay } from '@/utils/workDays';

interface PanelSettings {
  title: string;
  startedAt: number;
  endedAt: number | null;
  overlapAllowed: (entry: TimelineEntry) => boolean;
  save: (startedAt: number, endedAt: number | null) => Promise<void>;
}

// An entry's start, or (with no entry) the moment work stopped with nothing after it.
interface TimelinePoint {
  key: string;
  time: number;
  entry: DayEntry | null;
  running: boolean;
}

function toIso(milliseconds: number) {
  return new Date(milliseconds).toISOString();
}

// Each entry's start, plus a stop wherever the next entry doesn't begin the moment one ends:
// after End day, and at the end of the day's work.
function getTimelinePoints(entries: DayEntry[], now: number): TimelinePoint[] {
  return entries.flatMap((entry, index) => {
    const key = `${entry.kind}-${entry.id}`;
    const start = { key, time: Date.parse(entry.started_at), entry, running: false };
    if (entry.ended_at && entries[index + 1]?.started_at === entry.ended_at) return [start];
    const stop = {
      key: `${key}-stop`,
      time: entry.ended_at ? Date.parse(entry.ended_at) : now,
      entry: null,
      running: entry.ended_at === null,
    };
    return [start, stop];
  });
}

interface DaySummaryProps {
  day: WorkDay;
  segments: TimeRange[];
  breaks: TimeRange[];
  now: number;
  cost: DayCost | null;
}

function DaySummary({ day, segments, breaks, now, cost }: DaySummaryProps) {
  const inShop = day.lastStop - day.firstStart;
  const rows = [
    { label: 'Worked', milliseconds: day.worked, dot: null, color: colors.primary },
    { label: 'Break', milliseconds: day.onBreak, dot: styles.breakDot, color: colors.accent },
    {
      label: 'Other',
      milliseconds: inShop - day.worked - day.onBreak,
      dot: styles.stopDot,
      color: colors.secondaryText,
    },
  ];

  return (
    <View style={styles.summary}>
      <Text style={styles.hours}>
        {formatClockTime(day.firstStart)} to {formatClockTime(day.lastStop)}
      </Text>
      <View style={styles.summaryRow}>
        <Text style={styles.summaryLabel}>In the shop</Text>
        <Text style={styles.summaryValue}>{formatDuration(inShop)}</Text>
      </View>
      {rows.map(({ label, milliseconds, dot, color }) => (
        <View key={label} style={styles.summaryRow}>
          <View style={styles.summaryKey}>
            <View style={[styles.dot, styles.summaryDot, dot]} />
            <Text style={[styles.summaryLabel, { color }]}>{label}</Text>
          </View>
          <Text style={[styles.summaryValue, { color }]}>{formatDuration(milliseconds)}</Text>
        </View>
      ))}
      <DayTicks ticks={getDayTicks(day, segments, breaks, now)} />
      {/* Below a line, since cost goes by the pieces finished, not by the hours above. */}
      {cost && (
        <>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>
              Cost of {cost.pieceCount} finished {cost.pieceCount === 1 ? 'piece' : 'pieces'}
              {cost.estimated ? ', est.' : ''}
            </Text>
            <Text style={styles.summaryValue}>{formatCost(cost.cents)}</Text>
          </View>
        </>
      )}
    </View>
  );
}

export default function DayScreen() {
  const params = useLocalSearchParams<{ dayStart: string }>();
  const dayStart = Number(params.dayStart);
  const [entries, setEntries] = useState<DayEntry[]>([]);
  const [cost, setCost] = useState<DayCost | null>(null);
  // A running entry counts up to when the page loaded.
  const [loadedAt, setLoadedAt] = useState(0);
  const [panel, setPanel] = useState<PanelSettings | null>(null);
  const { changeTimes } = useWorkStore();

  const load = useCallback(() => {
    const from = toIso(dayStart);
    const to = toIso(startOfNextDay(dayStart));
    Promise.all([getDayEntries(from, to), getDayCost(from, to)])
      .then(([dayEntries, dayCost]) => {
        setEntries(dayEntries);
        setCost(dayCost);
        setLoadedAt(Date.now());
      })
      .catch((error: Error) => Alert.alert('Could not load the day', error.message));
  }, [dayStart]);

  useEffect(load, [load]);

  async function saveAndReload(saving: Promise<void>) {
    await saving;
    setPanel(null);
    load();
  }

  function editEntry(entry: DayEntry) {
    setPanel({
      title: entry.piece_name ?? 'Break',
      startedAt: Date.parse(entry.started_at),
      endedAt: entry.ended_at ? Date.parse(entry.ended_at) : null,
      overlapAllowed: (other) => other.kind === entry.kind && other.id === entry.id,
      save: (startedAt, endedAt) =>
        saveAndReload(
          changeTimes(
            entry.kind,
            entry.id,
            toIso(startedAt),
            endedAt === null ? null : toIso(endedAt),
          ),
        ),
    });
  }

  function newBreak() {
    // Noon to 12:30, or the half hour up to now when that hasn't happened yet today. Set on the
    // clock, not as hours after midnight, so a daylight saving day still gets 12:30.
    const endedAt = Math.min(new Date(dayStart).setHours(12, 30), Date.now());
    const startedAt = Math.max(endedAt - 30 * 60 * 1000, dayStart);
    setPanel({
      title: 'Add break',
      startedAt,
      endedAt,
      // A break falls inside the work it interrupts, and splits it.
      overlapAllowed: (other) => other.kind === 'segment',
      // A new break always starts with an end, and the panel never removes one.
      save: (startedAt, endedAt) => saveAndReload(addBreak(toIso(startedAt), toIso(endedAt!))),
    });
  }

  const points = getTimelinePoints(entries, loadedAt);
  const segments = entries.filter((entry) => entry.kind === 'segment');
  const breaks = entries.filter((entry) => entry.kind === 'break');
  const day = getWholeDays(segments, breaks, loadedAt).find(
    (workDay) => workDay.dayStart === dayStart,
  );

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.page}
      stickyHeaderIndices={[day ? 1 : 0]}
    >
      {day && (
        <DaySummary day={day} segments={segments} breaks={breaks} now={loadedAt} cost={cost} />
      )}
      <View style={styles.pinnedBar}>
        <View style={styles.titleRow}>
          <Stack.Screen options={{ title: formatDay(dayStart) }} />
          <Text style={styles.title}>Timeline</Text>
          <Pressable
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={newBreak}
          >
            <Text style={styles.buttonText}>Add break</Text>
          </Pressable>
        </View>
      </View>
      {points.map((point, index) => {
        const rail = (
          <View style={styles.rail}>
            {index > 0 && points[index - 1].entry && (
              <View style={[styles.line, styles.lineAbove]} />
            )}
            {point.entry && <View style={[styles.line, styles.lineBelow]} />}
            <View
              style={[
                styles.dot,
                !point.entry && styles.stopDot,
                point.entry && !point.entry.piece_name && styles.breakDot,
              ]}
            />
          </View>
        );
        const { entry } = point;
        if (!entry) {
          return (
            <View key={point.key} style={styles.point}>
              <Text style={[styles.time, styles.stopText]}>
                {point.running ? 'Now' : formatClockTime(point.time)}
              </Text>
              {rail}
              <Text style={[styles.pointBody, styles.entryName, styles.stopText]}>
                {point.running ? 'Running' : 'Stopped'}
              </Text>
            </View>
          );
        }
        const end = entry.ended_at ? Date.parse(entry.ended_at) : loadedAt;
        return (
          <Pressable
            key={point.key}
            style={({ pressed }) => [styles.point, pressed && styles.buttonPressed]}
            onPress={() => editEntry(entry)}
          >
            <Text style={styles.time}>{formatClockTime(point.time)}</Text>
            {rail}
            <View style={styles.pointBody}>
              <Text style={[styles.entryName, !entry.piece_name && styles.breakName]}>
                {entry.piece_name ?? 'Break'}
              </Text>
              <Text style={styles.duration}>{formatDuration(end - point.time)}</Text>
            </View>
            <Chevron />
          </Pressable>
        );
      })}
      {panel && (
        <EntryTimesPanel
          title={panel.title}
          initialStartedAt={panel.startedAt}
          initialEndedAt={panel.endedAt}
          overlapAllowed={panel.overlapAllowed}
          onCancel={() => setPanel(null)}
          onSave={panel.save}
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    padding: 16,
  },
  summary: {
    marginBottom: 16,
    padding: 16,
    gap: 8,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  hours: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  summaryKey: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  // The timeline's dot sits a little low to line up with its text; here the row centers it.
  summaryDot: {
    marginTop: 0,
  },
  summaryLabel: {
    fontSize: 16,
    color: colors.text,
  },
  summaryValue: {
    fontSize: 18,
    fontVariant: ['tabular-nums'],
    color: colors.text,
  },
  summaryDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
  },
  // The pinned header moves this style onto its own wrapper, so the row's layout sits on the
  // View inside. The background keeps the timeline from showing through as it scrolls under.
  pinnedBar: {
    paddingBottom: 16,
    backgroundColor: colors.background,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
  },
  point: {
    flexDirection: 'row',
    gap: 12,
  },
  time: {
    width: 92,
    fontSize: 16,
    lineHeight: 20,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
    color: colors.text,
  },
  rail: {
    width: 14,
    alignItems: 'center',
  },
  line: {
    position: 'absolute',
    width: 2,
    backgroundColor: colors.separator,
  },
  lineAbove: {
    top: 0,
    height: 10,
  },
  lineBelow: {
    top: 10,
    bottom: 0,
  },
  dot: {
    width: 12,
    height: 12,
    marginTop: 4,
    borderRadius: 6,
    backgroundColor: colors.primary,
  },
  breakDot: {
    backgroundColor: colors.accent,
  },
  stopDot: {
    borderWidth: 2,
    borderColor: colors.secondaryText,
    backgroundColor: colors.background,
  },
  pointBody: {
    flex: 1,
    gap: 2,
    paddingBottom: 20,
  },
  entryName: {
    fontSize: 16,
    lineHeight: 20,
    color: colors.text,
  },
  breakName: {
    color: colors.accent,
  },
  duration: {
    fontSize: 16,
    color: colors.secondaryText,
  },
  stopText: {
    color: colors.secondaryText,
  },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  buttonPressed: {
    opacity: 0.6,
  },
  buttonText: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.textOnFill,
  },
});
