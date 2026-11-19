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

import { CountField, getCountTexts, noCount, type CountTexts } from '@/components/CountField';
import { Dropdown } from '@/components/Dropdown';
import { FieldError, useMissingFields } from '@/components/FieldError';
import {
  getSupplyGroups,
  getSupplyKinds,
  type SupplyDetails,
  type SupplyKind,
  type SupplyRecord,
} from '@/db/queries/supplyQueries';
import { colors } from '@/theme';
import { formatEachCost, formatSupplyPrice, parseCaseCount, parseCost } from '@/utils/cost';
import { getSupplyMissing, missingMessages } from '@/utils/missingFields';
import { parseSize, type BatchSize } from '@/utils/prepTime';
import { showError } from '@/utils/showError';

interface SupplyPanelProps {
  initial: SupplyRecord | null;
  onCancel: () => void;
  // sameAsId: the earlier supply picked in Same as when adding, whose kind the new one joins.
  onSave: (details: SupplyDetails, sameAsId: number | null) => Promise<void>;
}

const newSupplyKey = 'new';

// The Group dropdown's first and last options. A saved group is never blank, so neither clashes.
const noGroupKey = '';
const newGroupKey = -1;

function getCostText(costCents: number) {
  return (costCents / 100).toFixed(2);
}

// A supply bought singly has no case count to show.
function getCountText(caseCount: number) {
  return caseCount === 1 ? null : String(caseCount);
}

// A supply with no size has no size boxes to show.
function getSizeTexts(supply: BatchSize) {
  return supply.size_amount === null ? null : getCountTexts(supply);
}

const sizeHelp =
  'The size of one, like a rod of 18 inches or a bag of 1000 g. Each piece then enters how much it used in that unit, and its share of the cost comes from that.';

// A supply is what was bought and what it cost, like a tube at $15, or a case of 16 tubes at $240,
// which the app divides into the price of one. One used by length or weight gets a size, like 18
// inches. Adding one offers Same as: an earlier supply of each kind, which fills the form in.
export function SupplyPanel({ initial, onCancel, onSave }: SupplyPanelProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [costText, setCostText] = useState(initial ? getCostText(initial.cost_cents) : '');
  // How many came in the case, or null while it's entered as bought singly.
  const [countText, setCountText] = useState(initial ? getCountText(initial.case_count) : null);
  // The size boxes, or null while it has no size.
  const [sizeTexts, setSizeTexts] = useState<CountTexts | null>(
    initial ? getSizeTexts(initial) : null,
  );
  // The group it's listed under, empty for none.
  const [groupText, setGroupText] = useState(initial?.group_name ?? '');
  const [typingNewGroup, setTypingNewGroup] = useState(false);
  const [savedGroups, setSavedGroups] = useState<string[]>([]);
  const [kinds, setKinds] = useState<SupplyKind[]>([]);
  const [sameAsId, setSameAsId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const trimmedName = name.trim();
  const costCents = parseCost(costText);
  const caseCount = countText === null ? 1 : parseCaseCount(countText);
  const missingFields = useMissingFields(getSupplyMissing(name, costText, countText, sizeTexts));
  const caseCountMissing = missingFields.shown.includes('caseCount');
  const kindOptions = [
    ...kinds.map((kind) => ({
      key: kind.id,
      label: kind.name,
      detail: formatSupplyPrice(kind),
      kind,
    })),
    { key: newSupplyKey, label: 'New supply', kind: null },
  ];
  const groupOptions = [
    { key: noGroupKey, label: 'No group' },
    ...savedGroups.map((group) => ({ key: group, label: group })),
    { key: newGroupKey, label: 'New group' },
  ];

  useEffect(() => {
    if (initial) return;
    getSupplyKinds().then(setKinds).catch(showError('Could not load your supplies'));
  }, [initial]);

  useEffect(() => {
    getSupplyGroups().then(setSavedGroups).catch(showError('Could not load your groups'));
  }, []);

  // New group empties the box so it's typed fresh; a saved one or No group fills it in.
  function chooseGroup(key: string | number) {
    setTypingNewGroup(key === newGroupKey);
    setGroupText(typeof key === 'string' ? key : '');
  }

  // Everything it fills in can still be changed before Add. Going back to New supply empties
  // what an earlier supply filled in.
  function chooseKind(kind: SupplyKind | null) {
    if (kind === null && sameAsId === null) return;
    setSameAsId(kind?.id ?? null);
    setName(kind?.name ?? '');
    setCostText(kind ? getCostText(kind.cost_cents) : '');
    setCountText(kind ? getCountText(kind.case_count) : null);
    setSizeTexts(kind ? getSizeTexts(kind) : null);
    setGroupText(kind?.group_name ?? '');
    setTypingNewGroup(false);
  }

  function handleSave() {
    if (!missingFields.check()) return;
    setSaving(true);
    const size =
      sizeTexts === null
        ? noCount
        : { sizeAmount: parseSize(sizeTexts.amountText)!, sizeUnit: sizeTexts.unitText.trim() };
    onSave(
      {
        name: trimmedName,
        costCents: costCents!,
        caseCount: caseCount!,
        ...size,
        groupName: groupText.trim() || null,
      },
      sameAsId,
    ).catch((error: Error) => {
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
            style={[styles.input, missingFields.shown.includes('name') && styles.missingInput]}
            value={name}
            onChangeText={setName}
            placeholder="Name, like 32.7 × 4 tube"
            placeholderTextColor={colors.secondaryText}
            autoFocus={!initial}
          />
          {missingFields.shown.includes('name') && <FieldError message={missingMessages.name} />}
          <View style={styles.fieldRow}>
            <Text style={styles.label}>Group</Text>
            <View style={styles.fill}>
              <Dropdown
                options={groupOptions}
                selectedKey={typingNewGroup ? newGroupKey : groupText}
                placeholder="No group"
                onSelect={(option) => chooseGroup(option.key)}
                floating
              />
            </View>
          </View>
          {typingNewGroup && (
            <TextInput
              style={styles.input}
              value={groupText}
              onChangeText={setGroupText}
              placeholder="Group, like Color rods"
              placeholderTextColor={colors.secondaryText}
              autoFocus
            />
          )}
          <View style={styles.fieldRow}>
            <Text style={[styles.label, styles.fill]}>
              {countText === null ? 'Cost' : 'Case cost'}
            </Text>
            <Text style={styles.label}>$</Text>
            <TextInput
              style={[
                styles.input,
                styles.costInput,
                missingFields.shown.includes('cost') && styles.missingInput,
              ]}
              value={costText}
              onChangeText={setCostText}
              keyboardType="decimal-pad"
            />
          </View>
          {missingFields.shown.includes('cost') && <FieldError message={missingMessages.cost} />}
          {countText !== null && (
            <>
              <View style={styles.fieldRow}>
                <Text style={[styles.label, styles.fill]}>How many in it</Text>
                <TextInput
                  style={[styles.input, styles.costInput, caseCountMissing && styles.missingInput]}
                  value={countText}
                  onChangeText={setCountText}
                  keyboardType="number-pad"
                />
              </View>
              {caseCountMissing ? (
                <FieldError message={missingMessages.caseCount} />
              ) : (
                costCents !== null &&
                caseCount !== null && (
                  <Text style={styles.note}>{formatEachCost(costCents, caseCount)}</Text>
                )
              )}
            </>
          )}
          <Pressable
            style={({ pressed }) => [styles.switchButton, pressed && styles.buttonPressed]}
            onPress={() => setCountText(countText === null ? '' : null)}
          >
            <Text style={styles.switchText}>
              {countText === null ? 'Bought a case?' : 'Bought one'}
            </Text>
          </Pressable>
          {sizeTexts !== null && (
            <CountField
              label={countText === null ? 'Size' : 'Size of each'}
              note="Like 18 inches or 1000 g."
              help={sizeHelp}
              missingMessage={missingMessages.sizeNumber}
              texts={sizeTexts}
              onChange={setSizeTexts}
              missingNumber={missingFields.shown.includes('sizeNumber')}
              missingUnit={missingFields.shown.includes('sizeUnit')}
            />
          )}
          <Pressable
            style={({ pressed }) => [styles.switchButton, pressed && styles.buttonPressed]}
            onPress={() =>
              setSizeTexts(sizeTexts === null ? { amountText: '', unitText: '' } : null)
            }
          >
            <Text style={styles.switchText}>
              {sizeTexts === null ? 'Used by length or weight?' : 'No size'}
            </Text>
          </Pressable>
          <View style={styles.buttonRow}>
            <Pressable style={styles.textButton} onPress={onCancel}>
              <Text style={styles.textButtonText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.saveButton, saving && styles.buttonDisabled]}
              onPress={handleSave}
              disabled={saving}
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
  missingInput: {
    borderColor: colors.danger,
  },
  note: {
    fontSize: 16,
    color: colors.secondaryText,
  },
  switchButton: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  buttonPressed: {
    opacity: 0.6,
  },
  switchText: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.primary,
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
