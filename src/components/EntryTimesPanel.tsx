import DateTimePicker from '@react-native-community/datetimepicker';
import { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FieldError, useMissingFields } from '@/components/FieldError';
import { getOverlaps, type TimelineEntry } from '@/db/queries/entryQueries';
import { colors } from '@/theme';
import { formatClockTime, formatDay } from '@/utils/formatTime';
import { getOverlapMissing } from '@/utils/missingFields';
import { showError } from '@/utils/showError';

interface EntryTimesPanelProps {
  title: string;
  initialStartedAt: number;
  // null for a running entry, which can stay running or be given an end.
  initialEndedAt: number | null;
  // An entry these times may overlap: the entry being changed, or the work a new break falls in.
  overlapAllowed?: (entry: TimelineEntry) => boolean;
  onCancel: () => void;
  onSave: (startedAt: number, endedAt: number | null) => Promise<void>;
}

// Yesterday at the given hour, the most likely day to be catching up on.
export function yesterdayAt(hours: number) {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  date.setHours(hours, 0, 0, 0);
  return date.getTime();
}

// Start and End as they're picked. Moving Start past End moves End with it, keeping the length,
// and End's picker can't go before Start. Everything the times overlap is loaded as they change;
// a running entry (no end) is checked up to now.
export function useEntryTimes<EndedAt extends number | null>(
  initialStartedAt: number,
  initialEndedAt: EndedAt,
) {
  const [startedAt, setStartedAt] = useState(initialStartedAt);
  const [endedAt, setEndedAt] = useState(initialEndedAt);
  const [overlaps, setOverlaps] = useState<TimelineEntry[]>([]);

  useEffect(() => {
    // Only the newest pick's overlaps are kept, whichever load finishes last.
    let newest = true;
    getOverlaps(new Date(startedAt).toISOString(), new Date(endedAt ?? Date.now()).toISOString())
      .then((found) => {
        if (newest) setOverlaps(found);
      })
      .catch(showError('Could not check the times'));
    return () => {
      newest = false;
    };
  }, [startedAt, endedAt]);

  function changeStart(newStartedAt: number) {
    setStartedAt(newStartedAt);
    if (endedAt !== null && newStartedAt > endedAt) {
      setEndedAt((newStartedAt + endedAt - startedAt) as EndedAt);
    }
  }

  return { startedAt, endedAt, overlaps, changeStart, setEndedAt };
}

// "Overlaps Flower pendant, Nov 6, 9:15 AM to 10:00 AM". The end has its own day when it's on
// another one, and is "now" while the entry runs.
export function getOverlapMessage({ piece_name, started_at, ended_at }: TimelineEntry) {
  const start = Date.parse(started_at);
  const end = ended_at === null ? null : Date.parse(ended_at);
  const endText =
    end === null
      ? 'now'
      : formatDay(end) === formatDay(start)
        ? formatClockTime(end)
        : `${formatDay(end)}, ${formatClockTime(end)}`;
  return `Overlaps ${piece_name ?? 'a break'}, ${formatDay(start)}, ${formatClockTime(start)} to ${endText}.`;
}

// Slides up from the bottom to change an entry's start and end. What they overlap shows under
// them as they're picked, and Save won't save over it.
export function EntryTimesPanel({
  title,
  initialStartedAt,
  initialEndedAt,
  overlapAllowed = () => false,
  onCancel,
  onSave,
}: EntryTimesPanelProps) {
  const { startedAt, endedAt, overlaps, changeStart, setEndedAt } = useEntryTimes(
    initialStartedAt,
    initialEndedAt,
  );
  const [saving, setSaving] = useState(false);
  const overlap = overlaps.find((entry) => !overlapAllowed(entry));
  const missingFields = useMissingFields(getOverlapMissing(overlap !== undefined));

  function handleSave() {
    if (!missingFields.check()) return;
    setSaving(true);
    onSave(startedAt, endedAt).catch((error: Error) => {
      setSaving(false);
      Alert.alert('Could not save', error.message);
    });
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <SafeAreaView edges={{ bottom: 'additive' }} style={styles.panel}>
          <Text style={styles.title}>{title}</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Start</Text>
            <DateTimePicker
              value={new Date(startedAt)}
              mode="datetime"
              display="compact"
              accentColor={colors.primary}
              onValueChange={(_event, date) => changeStart(date.getTime())}
            />
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>End</Text>
            {endedAt === null ? (
              <Pressable style={styles.textButton} onPress={() => setEndedAt(Date.now())}>
                <Text style={styles.textButtonText}>Running, set an end</Text>
              </Pressable>
            ) : (
              <DateTimePicker
                value={new Date(endedAt)}
                mode="datetime"
                display="compact"
                accentColor={colors.primary}
                minimumDate={new Date(startedAt)}
                onValueChange={(_event, date) => setEndedAt(date.getTime())}
              />
            )}
          </View>
          {overlap && <FieldError message={getOverlapMessage(overlap)} />}
          <View style={styles.buttonRow}>
            <Pressable style={styles.textButton} onPress={onCancel}>
              <Text style={styles.textButtonText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.saveButton, saving && styles.buttonDisabled]}
              onPress={handleSave}
              disabled={saving}
            >
              <Text style={styles.saveButtonText}>Save</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  panel: {
    padding: 16,
    gap: 12,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    backgroundColor: colors.surface,
  },
  title: {
    fontSize: 20,
    color: colors.text,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  label: {
    fontSize: 18,
    color: colors.text,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  textButton: {
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  textButtonText: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.text,
  },
  saveButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  saveButtonText: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.textOnFill,
  },
});
