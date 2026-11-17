import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Chevron } from '@/components/Chevron';
import { SupplyPanel } from '@/components/SupplyPanel';
import {
  addSupply,
  getSupplies,
  type SupplyDetails,
  type SupplyRecord,
} from '@/db/queries/supplyQueries';
import { colors } from '@/theme';
import { formatCost, formatSupplyPrice } from '@/utils/cost';
import { formatDay } from '@/utils/formatTime';
import { showError } from '@/utils/showError';

// Every supply with the day it was priced and its cost. Add supply in the header; a row opens the
// supply's page.
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

  async function save(details: SupplyDetails, sameAsId: number | null) {
    await addSupply(details, sameAsId);
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
            {/* The cost of one is what a piece is charged, so it sits beside the name. The case
                it came in and the day it was priced go on the line below. */}
            <View style={styles.details}>
              <View style={styles.lineRow}>
                <Text style={styles.name} numberOfLines={1}>
                  {supply.name}
                </Text>
                <Text style={styles.cost}>{formatSupplyPrice(supply)}</Text>
              </View>
              <View style={styles.lineRow}>
                {supply.case_count > 1 && (
                  <Text style={styles.detailText}>
                    Case of {supply.case_count} for {formatCost(supply.cost_cents)}
                  </Text>
                )}
                <Text style={[styles.detailText, styles.pricedText]}>
                  Priced {formatDay(Date.parse(supply.priced_at))}
                </Text>
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
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  // A long name gives up its width and ends in "…". The cost beside it never does.
  name: {
    flex: 1,
    fontSize: 20,
    color: colors.text,
  },
  // On the right, even when there's no case on the left.
  pricedText: {
    marginLeft: 'auto',
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
