import { useEffect, useState } from 'react';
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
import { SafeAreaView } from 'react-native-safe-area-context';

import { Dropdown } from '@/components/Dropdown';
import {
  getSupplyKinds,
  type SupplyDetails,
  type SupplyKind,
  type SupplyRecord,
} from '@/db/queries/supplyQueries';
import { colors } from '@/theme';
import { formatCost, parseCost } from '@/utils/cost';
import { showError } from '@/utils/showError';

interface SupplyPanelProps {
  initial: SupplyRecord | null;
  onCancel: () => void;
  // sameAsId: the earlier supply picked in Same as when adding, whose kind the new one joins.
  onSave: (details: SupplyDetails, sameAsId: number | null) => Promise<void>;
}

const newSupplyKey = 'new';

function getCostText(costCents: number) {
  return (costCents / 100).toFixed(2);
}

// A supply is what was bought and what it cost, like a tube at $15. Adding one offers Same as: an
// earlier supply of each kind, which fills the form in.
export function SupplyPanel({ initial, onCancel, onSave }: SupplyPanelProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [costText, setCostText] = useState(initial ? getCostText(initial.cost_cents) : '');
  const [kinds, setKinds] = useState<SupplyKind[]>([]);
  const [sameAsId, setSameAsId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const trimmedName = name.trim();
  const canSave = !saving && trimmedName !== '' && costText.trim() !== '';
  const kindOptions = [
    ...kinds.map((kind) => ({
      key: kind.id,
      label: kind.name,
      detail: formatCost(kind.cost_cents),
      kind,
    })),
    { key: newSupplyKey, label: 'New supply', kind: null },
  ];

  useEffect(() => {
    if (initial) return;
    getSupplyKinds().then(setKinds).catch(showError('Could not load your supplies'));
  }, [initial]);

  // Everything it fills in can still be changed before Add. Going back to New supply empties
  // what an earlier supply filled in.
  function chooseKind(kind: SupplyKind | null) {
    if (kind === null && sameAsId === null) return;
    setSameAsId(kind?.id ?? null);
    setName(kind?.name ?? '');
    setCostText(kind ? getCostText(kind.cost_cents) : '');
  }

  function handleSave() {
    const costCents = parseCost(costText);
    if (costCents === null) {
      Alert.alert('Enter a cost like 40 or 12.50.');
      return;
    }
    setSaving(true);
    onSave({ name: trimmedName, costCents }, sameAsId).catch((error: Error) => {
      setSaving(false);
      Alert.alert('Could not save', error.message);
    });
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
      <KeyboardAvoidingView style={styles.overlay} behavior="padding">
        <SafeAreaView edges={{ bottom: 'additive' }} style={styles.panel}>
          <Text style={styles.title}>{initial ? 'Change supply' : 'Add supply'}</Text>
          {kinds.length > 0 && (
            <View style={styles.fieldRow}>
              <Text style={styles.label}>Same as</Text>
              <View style={styles.fill}>
                <Dropdown
                  options={kindOptions}
                  selectedKey={sameAsId ?? newSupplyKey}
                  placeholder="New supply"
                  onSelect={(option) => chooseKind(option.kind)}
                  floating
                />
              </View>
            </View>
          )}
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Name, like 32.7 × 4 tube"
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
        </SafeAreaView>
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
