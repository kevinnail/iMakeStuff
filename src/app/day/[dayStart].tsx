import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { EntryTimesPanel } from '@/components/EntryTimesPanel';
import {
  addBreak,
  getDayEntries,
  updateEntryTimes,
  type DayEntry,
} from '@/db/queries/entryQueries';
import { formatClockTime, formatDay } from '@/utils/formatTime';
import { startOfNextDay } from '@/utils/workDays';

interface PanelSettings {
  title: string;
  startedAt: number;
  endedAt: number | null;
  save: (startedAt: number, endedAt: number | null) => Promise<void>;
}

function toIso(milliseconds: number) {
  return new Date(milliseconds).toISOString();
}

export default function DayScreen() {
  const params = useLocalSearchParams<{ dayStart: string }>();
  const dayStart = Number(params.dayStart);
  const [entries, setEntries] = useState<DayEntry[]>([]);
  const [panel, setPanel] = useState<PanelSettings | null>(null);

  const load = useCallback(() => {
    getDayEntries(toIso(dayStart), toIso(startOfNextDay(dayStart)))
      .then(setEntries)
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

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.page}>
      <Stack.Screen options={{ title: formatDay(dayStart) }} />
      {entries.map((entry) => (
        <Pressable
          key={`${entry.kind}-${entry.id}`}
          style={styles.entryRow}
          onPress={() => editEntry(entry)}
        >
          <Text style={styles.time}>{formatClockTime(Date.parse(entry.started_at))}</Text>
          <Text style={styles.time}>
            {entry.ended_at ? formatClockTime(Date.parse(entry.ended_at)) : 'Running'}
          </Text>
          <Text style={[styles.entryName, !entry.piece_name && styles.breakName]}>
            {entry.piece_name ?? 'Break'}
          </Text>
        </Pressable>
      ))}
      <View style={styles.buttonRow}>
        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={newBreak}
        >
          <Text style={styles.buttonText}>Add break</Text>
        </Pressable>
      </View>
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
    gap: 4,
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 12,
    paddingVertical: 8,
  },
  time: {
    width: 84,
    fontSize: 16,
    fontVariant: ['tabular-nums'],
  },
  entryName: {
    flex: 1,
    fontSize: 16,
  },
  breakName: {
    color: '#555',
  },
  buttonRow: {
    flexDirection: 'row',
    paddingTop: 12,
  },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: '#1a1a1a',
  },
  buttonPressed: {
    opacity: 0.6,
  },
  buttonText: {
    fontSize: 18,
    lineHeight: 20,
    color: '#fff',
  },
});
