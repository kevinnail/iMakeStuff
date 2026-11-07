import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Chevron } from '@/components/Chevron';
import { AssignedBar } from '@/components/AssignedBar';
import { SupplyPanel } from '@/components/SupplyPanel';
import {
  addSupply,
  getSupplies,
  type SupplyDetails,
  type SupplyRecord,
} from '@/db/queries/supplyQueries';
import { colors } from '@/theme';
import { formatCost } from '@/utils/cost';
import { formatDay } from '@/utils/formatTime';
import { showError } from '@/utils/showError';

// Every supply with how much of its cost is assigned, the day it was bought, and its cost. Add supply in the
// header; a row opens the supply's page.
export default function SuppliesScreen() {
  const [supplies, setSupplies] = useState<SupplyRecord[]>([]);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => getSupplies().then(setSupplies), []);

  // Reloads every time the list is shown, so a change on a supply's page shows on going back.
  useFocusEffect(
    useCallback(() => {
      load().catch(showError('Could not load your supplies'));
    }, [load]),
  );

  async function save(details: SupplyDetails) {
    await addSupply(details);
    setAdding(false);
    await load();
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              style={({ pressed }) => [styles.addButton, pressed && styles.buttonPressed]}
              onPress={() => setAdding(true)}
            >
              <Text style={styles.addButtonText}>Add supply</Text>
            </Pressable>
          ),
        }}
      />
      <FlatList
        data={supplies}
        keyExtractor={(supply) => String(supply.id)}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={<Text style={styles.detailText}>No supplies yet.</Text>}
        renderItem={({ item: supply }) => (
          <Pressable
            style={({ pressed }) => [styles.row, pressed && styles.buttonPressed]}
            onPress={() => router.push({ pathname: '/supply/[id]', params: { id: supply.id } })}
          >
            <View style={styles.details}>
              <Text style={styles.name}>{supply.name}</Text>
              <AssignedBar
                usedShare={supply.used_share}
                usedUp={supply.used_up === 1}
                costCents={supply.cost_cents}
              />
              <View style={styles.bottomRow}>
                <Text style={[styles.detailText, styles.fill]}>
                  Bought {formatDay(Date.parse(supply.bought_at))}
                </Text>
                <Text style={styles.cost}>{formatCost(supply.cost_cents)}</Text>
              </View>
            </View>
            <Chevron />
          </Pressable>
        )}
      />
      {adding && <SupplyPanel initial={null} onCancel={() => setAdding(false)} onSave={save} />}
    </>
  );
}

const styles = StyleSheet.create({
  list: {
    padding: 16,
    gap: 12,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginTop: 12,
    backgroundColor: colors.separator,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  details: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: 20,
    color: colors.text,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  fill: {
    flex: 1,
  },
  detailText: {
    fontSize: 16,
    color: colors.secondaryText,
  },
  cost: {
    fontSize: 18,
    fontVariant: ['tabular-nums'],
    color: colors.text,
  },
  addButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  addButtonText: {
    fontSize: 16,
    lineHeight: 18,
    color: colors.textOnFill,
  },
  buttonPressed: {
    opacity: 0.6,
  },
});
