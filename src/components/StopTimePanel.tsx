import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '@/theme';

interface StopTimePanelProps {
  title: string;
  startedAt: number;
  initialEndedAt: number;
  onCancel: () => void;
  onSave: (endedAt: number) => Promise<void>;
}

// Slides up from the bottom to pick when a forgotten clock really stopped, between its start
// and now.
export function StopTimePanel({
  title,
  startedAt,
  initialEndedAt,
  onCancel,
  onSave,
}: StopTimePanelProps) {
  const insets = useSafeAreaInsets();
  const [openedAt] = useState(() => Date.now());
  const [endedAt, setEndedAt] = useState(initialEndedAt);
  const [saving, setSaving] = useState(false);
  const canSave = !saving && endedAt >= startedAt && endedAt <= openedAt;

  function handleSave() {
    setSaving(true);
    onSave(endedAt).catch((error: Error) => {
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
            <Text style={styles.label}>Stopped</Text>
            <DateTimePicker
              value={new Date(endedAt)}
              mode="datetime"
              display="compact"
              accentColor={colors.primary}
              minimumDate={new Date(startedAt)}
              maximumDate={new Date(openedAt)}
              onValueChange={(_event, date) => setEndedAt(date.getTime())}
            />
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
