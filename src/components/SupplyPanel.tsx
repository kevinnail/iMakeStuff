import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { SupplyDetails, SupplyRecord } from '@/db/queries/supplyQueries';
import { colors } from '@/theme';
import { parseCost } from '@/utils/cost';

interface SupplyPanelProps {
  initial: SupplyRecord | null;
  onCancel: () => void;
  onSave: (details: SupplyDetails) => Promise<void>;
}

export function SupplyPanel({ initial, onCancel, onSave }: SupplyPanelProps) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(initial?.name ?? '');
  const [costText, setCostText] = useState(initial ? (initial.cost_cents / 100).toFixed(2) : '');
  const [boughtAt, setBoughtAt] = useState(() =>
    initial ? Date.parse(initial.bought_at) : Date.now(),
  );
  const [saving, setSaving] = useState(false);
  const trimmedName = name.trim();
  const canSave = !saving && trimmedName !== '' && costText.trim() !== '';

  function handleSave() {
    const costCents = parseCost(costText);
    if (costCents === null) {
      Alert.alert('Enter a cost like 40 or 12.50.');
      return;
    }
    setSaving(true);
    onSave({ name: trimmedName, costCents, boughtAt: new Date(boughtAt).toISOString() }).catch(
      (error: Error) => {
        setSaving(false);
        Alert.alert('Could not save', error.message);
      },
    );
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
      <KeyboardAvoidingView style={styles.overlay} behavior="padding">
        <View style={[styles.panel, { paddingBottom: insets.bottom + 16 }]}>
          <Text style={styles.title}>{initial ? 'Change supply' : 'Add supply'}</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Name, like 5 ft tube"
            placeholderTextColor={colors.secondaryText}
            autoFocus={!initial}
          />
          <View style={styles.fieldRow}>
            <Text style={[styles.label, styles.fill]}>Cost</Text>
            <Text style={styles.label}>$</Text>
            <TextInput
              style={[styles.input, styles.costInput]}
              value={costText}
              onChangeText={setCostText}
              keyboardType="decimal-pad"
            />
          </View>
          <View style={styles.fieldRow}>
            <Text style={[styles.label, styles.fill]}>Bought</Text>
            <DateTimePicker
              value={new Date(boughtAt)}
              mode="date"
              display="compact"
              accentColor={colors.primary}
              onValueChange={(_event, date) => setBoughtAt(date.getTime())}
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
              <Text style={styles.saveButtonText}>{initial ? 'Save' : 'Add'}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
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
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  fill: {
    flex: 1,
  },
  label: {
    fontSize: 18,
    color: colors.text,
  },
  input: {
    fontSize: 18,
    padding: 8,
    color: colors.text,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.separator,
    borderRadius: 8,
  },
  costInput: {
    width: 120,
    textAlign: 'right',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  textButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
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
