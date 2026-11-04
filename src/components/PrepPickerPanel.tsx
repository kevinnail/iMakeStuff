import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { parsePercent } from '@/components/prepUsePrompts';
import type { AvailablePrep } from '@/db/queries/prepQueries';
import { colors } from '@/theme';

interface PrepPickerPanelProps {
  prepList: AvailablePrep[];
  onCancel: () => void;
  onAdd: (prep: AvailablePrep, estimatedPercent: number) => void;
}

export function PrepPickerPanel({ prepList, onCancel, onAdd }: PrepPickerPanelProps) {
  const insets = useSafeAreaInsets();
  const [chosenPrep, setChosenPrep] = useState<AvailablePrep | null>(null);
  const [percentText, setPercentText] = useState('');
  const canAdd = chosenPrep !== null && percentText !== '';

  function handleAdd() {
    const percent = parsePercent(percentText);
    if (chosenPrep === null) return;
    if (percent === null) Alert.alert('Enter a percent from 1 to 100.');
    else onAdd(chosenPrep, percent);
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
      <KeyboardAvoidingView style={styles.overlay} behavior="padding">
        <View style={[styles.panel, { paddingBottom: insets.bottom + 16 }]}>
          <Text style={styles.title}>Add prep</Text>
          {prepList.length === 0 && (
            <Text style={styles.secondaryText}>No finished prep to use.</Text>
          )}
          <ScrollView style={styles.prepList} contentContainerStyle={styles.prepListContent}>
            {prepList.map((prep) => {
              const chosen = chosenPrep?.id === prep.id;
              return (
                <Pressable
                  key={prep.id}
                  style={[styles.prepRow, chosen && styles.prepRowChosen]}
                  onPress={() => setChosenPrep(prep)}
                >
                  <Text style={[styles.prepName, chosen && styles.chosenText]}>{prep.name}</Text>
                  <Text style={[styles.percentLeft, chosen && styles.chosenText]}>
                    {prep.percent_left}% left
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          {chosenPrep && (
            <View style={styles.percentRow}>
              <Text style={styles.label}>Percent this piece took</Text>
              <TextInput
                style={styles.percentInput}
                value={percentText}
                onChangeText={setPercentText}
                keyboardType="number-pad"
                autoFocus
              />
              <Text style={styles.label}>%</Text>
            </View>
          )}
          <View style={styles.buttonRow}>
            <Pressable style={styles.cancelButton} onPress={onCancel}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.addButton, !canAdd && styles.buttonDisabled]}
              onPress={handleAdd}
              disabled={!canAdd}
            >
              <Text style={styles.addButtonText}>Add</Text>
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
    maxHeight: '85%',
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
  secondaryText: {
    fontSize: 18,
    color: colors.secondaryText,
  },
  prepList: {
    flexGrow: 0,
  },
  prepListContent: {
    gap: 8,
  },
  prepRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: colors.background,
  },
  prepRowChosen: {
    backgroundColor: colors.primary,
  },
  prepName: {
    flexShrink: 1,
    fontSize: 18,
    color: colors.text,
  },
  percentLeft: {
    fontSize: 18,
    fontVariant: ['tabular-nums'],
    color: colors.secondaryText,
  },
  chosenText: {
    color: colors.textOnFill,
  },
  percentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    fontSize: 18,
    color: colors.text,
  },
  percentInput: {
    marginLeft: 'auto',
    width: 72,
    fontSize: 18,
    padding: 8,
    textAlign: 'right',
    color: colors.text,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.separator,
    borderRadius: 8,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  cancelButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  cancelButtonText: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.text,
  },
  addButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  addButtonText: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.textOnFill,
  },
});
