import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme';

interface PrepLeftBarProps {
  // Every piece's estimate on the prep added together.
  usedPercent: number;
  usedUp: boolean;
}

// How much of a prep is left, as a bar to read at a glance, like checking the fridge. The
// amount is estimated until the prep is used up. The outline shows the whole bar, so the
// empty part reads as clearly as the green.
export function PrepLeftBar({ usedPercent, usedUp }: PrepLeftBarProps) {
  const left = usedUp ? 0 : Math.max(0, 100 - usedPercent);

  return (
    <View style={styles.row}>
      <View style={styles.bar}>
        <View style={[styles.fill, { width: `${left}%` }]} />
      </View>
      <Text style={styles.text}>
        {usedUp ? (
          'Used up'
        ) : (
          <>
            <Text style={styles.value}>{left}%</Text> left, est.
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
  text: {
    width: 128,
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
