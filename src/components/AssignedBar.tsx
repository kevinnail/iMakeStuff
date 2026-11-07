import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme';
import { formatCost } from '@/utils/cost';
import { formatPercent } from '@/utils/prepTime';

interface AssignedBarProps {
  usedShare: number;
  usedUp: boolean;
  costCents?: number;
}

// How much of a by eye batch's cost is assigned to what used it. Counted batches have no bar.
export function AssignedBar({ usedShare, usedUp, costCents }: AssignedBarProps) {
  const assigned = usedUp ? 1 : Math.min(1, usedShare);

  return (
    <View style={styles.row}>
      <View style={styles.bar}>
        <View style={[styles.fill, { width: `${assigned * 100}%` }]} />
      </View>
      <Text style={styles.text}>
        {usedUp ? (
          'All used'
        ) : costCents === undefined ? (
          <>
            <Text style={styles.value}>{formatPercent(usedShare)}</Text> assigned, est.
          </>
        ) : (
          <>
            <Text style={styles.value}>{formatCost(Math.round(usedShare * costCents))}</Text> of{' '}
            {formatCost(costCents)} assigned
          </>
        )}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
  },
  bar: {
    flex: 1,
    height: 14,
    borderRadius: 7,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.secondaryText,
    backgroundColor: colors.background,
  },
  fill: {
    height: '100%',
    backgroundColor: colors.prep,
  },
  // At least 128 so most rows' bars line up, wider when the text needs it, so it never wraps;
  // the bar gives up the room.
  text: {
    minWidth: 128,
    textAlign: 'right',
    fontSize: 16,
    color: colors.secondaryText,
  },
  value: {
    fontSize: 18,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    color: colors.text,
  },
});
