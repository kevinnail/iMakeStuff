import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/Card';
import { SupplyPanel } from '@/components/SupplyPanel';
import {
  deleteSupply,
  getSupply,
  updateSupply,
  type SupplyDetails,
  type SupplyRecord,
} from '@/db/queries/supplyQueries';
import { colors } from '@/theme';
import { formatSupplyPrice } from '@/utils/cost';
import { formatDay } from '@/utils/formatTime';
import { showError } from '@/utils/showError';

// A supply's cost and the day it was priced, Edit to change them, and Delete supply.
export default function SupplyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const supplyId = Number(id);
  // undefined while loading, null when there's no supply with this id.
  const [supply, setSupply] = useState<SupplyRecord | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);

  const load = useCallback(() => getSupply(supplyId).then(setSupply), [supplyId]);

  useFocusEffect(
    useCallback(() => {
      load().catch(showError('Could not load the supply'));
    }, [load]),
  );

  if (supply === undefined) return null;
  if (supply === null) return <Text style={styles.text}>No supply with this id.</Text>;

  // "1 prep and 9 pieces": the prep that used it and every piece whose cost it's in, including
  // pieces that used that prep.
  const costParts = [
    { count: supply.prep_count, one: 'prep', many: 'preps' },
    { count: supply.piece_count, one: 'piece', many: 'pieces' },
  ]
    .filter(({ count }) => count > 0)
    .map(({ count, one, many }) => `${count} ${count === 1 ? one : many}`);
  const deleteMessage =
    costParts.length === 0
      ? 'It comes off your supplies.'
      : `Its cost comes off ${costParts.join(' and ')}.`;

  async function save(details: SupplyDetails) {
    await updateSupply(supplyId, details);
    setEditing(false);
    await load();
  }

  function confirmDelete(name: string, message: string) {
    Alert.alert(`Delete ${name}?`, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          deleteSupply(supplyId)
            .then(() => router.back())
            .catch(showError('Could not delete the supply')),
      },
    ]);
  }

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.page}>
      <Stack.Screen
        options={{
          title: supply.name,
          headerRight: () => (
            <Pressable
              style={({ pressed }) => [styles.editButton, pressed && styles.buttonPressed]}
              onPress={() => setEditing(true)}
            >
              <Text style={styles.editButtonText}>Edit</Text>
            </Pressable>
          ),
        }}
      />
      <Card>
        <View style={styles.row}>
          <Text style={[styles.text, styles.fill]}>Cost</Text>
          <Text style={[styles.value, styles.price]}>{formatSupplyPrice(supply)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={[styles.text, styles.fill]}>Priced</Text>
          <Text style={styles.value}>{formatDay(Date.parse(supply.priced_at))}</Text>
        </View>
      </Card>
      <Card>
        <Pressable
          style={({ pressed }) => [styles.row, pressed && styles.buttonPressed]}
          onPress={() => confirmDelete(supply.name, deleteMessage)}
        >
          <Text style={styles.deleteText}>Delete supply</Text>
        </Pressable>
      </Card>
      {editing && <SupplyPanel initial={supply} onCancel={() => setEditing(false)} onSave={save} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    padding: 16,
    gap: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  fill: {
    flex: 1,
  },
  text: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.text,
  },
  value: {
    fontSize: 18,
    lineHeight: 20,
    fontVariant: ['tabular-nums'],
    color: colors.text,
  },
  // "$15.00 each, case of 16 for $240.00" wraps beside its label.
  price: {
    flexShrink: 1,
    textAlign: 'right',
  },
  deleteText: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.danger,
  },
  editButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  editButtonText: {
    fontSize: 16,
    lineHeight: 18,
    color: colors.textOnFill,
  },
  buttonPressed: {
    opacity: 0.6,
  },
});
