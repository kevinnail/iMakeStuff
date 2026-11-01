import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface EntryTimesPanelProps {
  title: string;
  initialStartedAt: number;
  // null for a running entry, which can stay running or be given an end.
  initialEndedAt: number | null;
  onCancel: () => void;
  onSave: (startedAt: number, endedAt: number | null) => Promise<void>;
}

// Slides up from the bottom to change an entry's start and end.
export function EntryTimesPanel({
  title,
  initialStartedAt,
  initialEndedAt,
  onCancel,
  onSave,
}: EntryTimesPanelProps) {
  const insets = useSafeAreaInsets();
  const [startedAt, setStartedAt] = useState(initialStartedAt);
  const [endedAt, setEndedAt] = useState(initialEndedAt);
  const [saving, setSaving] = useState(false);
  const canSave = !saving && (endedAt === null || endedAt >= startedAt);

  function handleSave() {
    setSaving(true);
    onSave(startedAt, endedAt).catch((error: Error) => {
      setSaving(false);
      Alert.alert('Could not save', error.message);
    });
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={[styles.panel, { paddingBottom: insets.bottom + 16 }]}>
          <Text style={styles.title}>{title}</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Start</Text>
            <DateTimePicker
              value={new Date(startedAt)}
              mode="datetime"
              display="compact"
              onValueChange={(_event, date) => setStartedAt(date.getTime())}
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
                onValueChange={(_event, date) => setEndedAt(date.getTime())}
              />
            )}
          </View>
          <View style={styles.buttonRow}>
            <Pressable style={styles.textButton} onPress={onCancel}>
              <Text style={styles.textButtonText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.saveButton, !canSave && styles.buttonDisabled]}
              onPress={handleSave}
              disabled={!canSave}
            >
              <Text style={styles.saveButtonText}>Save</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  panel: {
    padding: 16,
    gap: 12,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 20,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  label: {
    fontSize: 18,
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
    color: '#1a1a1a',
  },
  saveButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: '#1a1a1a',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  saveButtonText: {
    fontSize: 18,
    lineHeight: 20,
    color: '#fff',
  },
});
