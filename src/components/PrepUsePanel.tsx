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

import type { AvailablePrep } from '@/db/queries/prepQueries';
import { colors } from '@/theme';

export interface PrepUseChoice {
  prep: { id: number; name: string };
  estimatedPercent: number;
}

interface PrepUsePanelProps {
  // Adding a use: the prep to choose from. Changing one: null.
  prepList: AvailablePrep[] | null;
  // Changing a use: it as saved. Adding one: null.
  initial: PrepUseChoice | null;
  onCancel: () => void;
  onSave: (choice: PrepUseChoice) => void;
  onRemove?: () => void;
}

// A whole number from 1 to 100, or null for anything else.
function parsePercent(text: string) {
  const percent = Number(text);
  return Number.isInteger(percent) && percent >= 1 && percent <= 100 ? percent : null;
}

export function PrepUsePanel({ prepList, initial, onCancel, onSave, onRemove }: PrepUsePanelProps) {
  const insets = useSafeAreaInsets();
  const [chosenPrep, setChosenPrep] = useState(initial?.prep ?? null);
  const [percentText, setPercentText] = useState(initial ? String(initial.estimatedPercent) : '');
  const canSave = chosenPrep !== null && percentText !== '';

  function handleSave() {
    const estimatedPercent = parsePercent(percentText);
    if (chosenPrep === null) return;
    if (estimatedPercent === null) Alert.alert('Enter a percent from 1 to 100.');
    else onSave({ prep: chosenPrep, estimatedPercent });
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
      <KeyboardAvoidingView style={styles.overlay} behavior="padding">
        <View style={[styles.panel, { paddingBottom: insets.bottom + 16 }]}>
          <Text style={styles.title}>{initial ? initial.prep.name : 'Add prep'}</Text>
          {prepList && prepList.length === 0 && (
            <Text style={styles.secondaryText}>No finished prep to use.</Text>
          )}
          {prepList && (
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
          )}
          {chosenPrep && (
            <View style={styles.fieldRow}>
              <Text style={styles.label}>Percent this piece took</Text>
              <TextInput
                style={styles.percentInput}
                value={percentText}
                onChangeText={setPercentText}
                keyboardType="number-pad"
                autoFocus={!initial}
              />
              <Text style={styles.label}>%</Text>
            </View>
          )}
          <View style={styles.buttonRow}>
            {onRemove && (
              <Pressable style={[styles.textButton, styles.removeButton]} onPress={onRemove}>
                <Text style={styles.removeButtonText}>Remove</Text>
              </Pressable>
            )}
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
  fieldRow: {
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
  textButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  textButtonText: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.text,
  },
  removeButton: {
    marginRight: 'auto',
    paddingHorizontal: 0,
  },
  removeButtonText: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.accent,
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
