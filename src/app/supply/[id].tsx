import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { Card } from '@/components/Card';
import { AssignedBar } from '@/components/AssignedBar';
import { SupplyPanel } from '@/components/SupplyPanel';
import {
  deleteSupply,
  getSupply,
  setSupplyUsedUp,
  updateSupply,
  type SupplyDetails,
  type SupplyRecord,
} from '@/db/queries/supplyQueries';
import { colors } from '@/theme';
import { formatCost } from '@/utils/cost';
import { formatDay } from '@/utils/formatTime';
import { showError } from '@/utils/showError';

// A supply's cost, what a counted one holds, and the day it was added, Edit to change them, All
// used with how much of a by eye one's cost is assigned, and Delete supply.
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

  const usedUp = supply.used_up === 1;
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

  function setUsedUp(value: boolean) {
    setSupplyUsedUp(supplyId, value).then(load).catch(showError('Could not save the supply'));
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
          <Text style={styles.value}>{formatCost(supply.cost_cents)}</Text>
        </View>
        {supply.size_amount !== null && (
          <View style={styles.row}>
            <Text style={[styles.text, styles.fill]}>Holds</Text>
            <Text style={styles.value}>
              {supply.size_amount} {supply.size_unit}
            </Text>
          </View>
        )}
        {supply.size_amount !== null && (
          <View style={styles.row}>
            <Text style={[styles.text, styles.fill]}>Cost per part</Text>
            <Text style={styles.value}>
              {formatCost(Math.round(supply.cost_cents / supply.size_amount))}
            </Text>
          </View>
        )}
        <View style={styles.row}>
          <Text style={[styles.text, styles.fill]}>Added</Text>
          <Text style={styles.value}>{formatDay(Date.parse(supply.created_at))}</Text>
        </View>
      </Card>
      {/* A counted supply never closes, so only a by eye one has All used. */}
      {supply.size_amount === null && (
        <Card>
          <View style={styles.row}>
            <View style={styles.fill}>
              <Text style={styles.text}>All used</Text>
              <Text style={styles.note}>Its full cost goes to what used it.</Text>
            </View>
            <Switch
              value={usedUp}
              onValueChange={setUsedUp}
              trackColor={{ true: colors.primary }}
            />
          </View>
          <View style={styles.row}>
            <View style={styles.fill}>
              <AssignedBar
                usedShare={supply.used_share}
                usedUp={usedUp}
                costCents={supply.cost_cents}
              />
            </View>
          </View>
        </Card>
      )}
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
  note: {
    fontSize: 16,
    color: colors.secondaryText,
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
