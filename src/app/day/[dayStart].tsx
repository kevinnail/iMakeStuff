import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Chevron } from '@/components/Chevron';
import { EntryTimesPanel } from '@/components/EntryTimesPanel';
import {
  addBreak,
  getDayEntries,
  updateEntryTimes,
  type DayEntry,
} from '@/db/queries/entryQueries';
import { colors } from '@/theme';
import { formatClockTime, formatDay, formatDuration } from '@/utils/formatTime';
import { startOfNextDay } from '@/utils/workDays';

interface PanelSettings {
  title: string;
  startedAt: number;
  endedAt: number | null;
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

export default function DayScreen() {
  const params = useLocalSearchParams<{ dayStart: string }>();
  const dayStart = Number(params.dayStart);
  const [entries, setEntries] = useState<DayEntry[]>([]);
  // A running entry counts up to when the page loaded.
  const [loadedAt, setLoadedAt] = useState(0);
  const [panel, setPanel] = useState<PanelSettings | null>(null);

  const load = useCallback(() => {
    getDayEntries(toIso(dayStart), toIso(startOfNextDay(dayStart)))
      .then((dayEntries) => {
        setEntries(dayEntries);
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
      save: (startedAt, endedAt) =>
        saveAndReload(
          updateEntryTimes(
            entry.kind,
            entry.id,
            toIso(startedAt),
            endedAt === null ? null : toIso(endedAt),
          ),
        ),
    });
  }

  function newBreak() {
    const noon = dayStart + 12 * 60 * 60 * 1000;
    setPanel({
      title: 'Add break',
      startedAt: noon,
      endedAt: noon + 30 * 60 * 1000,
      // A new break always starts with an end, and the panel never removes one.
      save: (startedAt, endedAt) => saveAndReload(addBreak(toIso(startedAt), toIso(endedAt!))),
    });
  }

  const points = getTimelinePoints(entries, loadedAt);

  return (
    // The title bar is the first child, so stickyHeaderIndices keeps Add break in reach however
    // long the day's timeline runs.
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.page}
      stickyHeaderIndices={[0]}
    >
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
  // The line down the left that joins each entry to the next.
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
