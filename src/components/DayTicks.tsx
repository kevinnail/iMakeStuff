import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme';
import type { Tick, TickKind } from '@/utils/dayTicks';

const tickColors: Record<TickKind, string> = {
  worked: colors.primary,
  break: colors.accent,
  other: colors.secondaryText,
  none: colors.separator,
};

// Under the ticks between midnight at each end. Each sits at its hour's tick, which moves on a
// daylight saving day.
const middleLabels = [
  { hour: 6, label: '6am' },
  { hour: 12, label: '12pm' },
  { hour: 18, label: '6pm' },
];
const axisLabelWidth = 48;

// The whole day, midnight to midnight, as a row of ticks, one per 10 minutes, colored like
// the timeline's dots. Each hour's tick is taller, and time out of the shop gets a short dim
// tick, so the row still reads as the whole day.
export function DayTicks({ ticks }: { ticks: Tick[] }) {
  return (
    <View style={styles.dayTicks}>
      <View style={styles.tickRow}>
        {ticks.map(({ kind, hour }, index) => {
          const isHour = hour !== null;
          return (
            <View
              key={index}
              style={[
                styles.tick,
                isHour && styles.hourTick,
                kind === 'none' && (isHour ? styles.shortHourTick : styles.shortTick),
                {
                  backgroundColor:
                    kind === 'none' && isHour ? colors.secondaryText : tickColors[kind],
                },
              ]}
            />
          );
        })}
      </View>
      <View style={styles.axis}>
        <Text style={[styles.axisLabel, styles.firstAxisLabel]}>12am</Text>
        {middleLabels.map(({ hour, label }) => (
          <Text
            key={label}
            style={[
              styles.axisLabel,
              {
                left: `${(ticks.findIndex((tick) => tick.hour === hour) / ticks.length) * 100}%`,
                marginLeft: -axisLabelWidth / 2,
              },
            ]}
          >
            {label}
          </Text>
        ))}
        <Text style={[styles.axisLabel, styles.lastAxisLabel]}>12am</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dayTicks: {
    gap: 4,
    paddingTop: 8,
  },
  tickRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 1,
    height: 28,
  },
  tick: {
    flex: 1,
    height: 18,
  },
  hourTick: {
    height: 28,
  },
  shortTick: {
    height: 6,
  },
  shortHourTick: {
    height: 12,
  },
  axis: {
    height: 20,
  },
  axisLabel: {
    position: 'absolute',
    width: axisLabelWidth,
    fontSize: 16,
    lineHeight: 20,
    textAlign: 'center',
    color: colors.secondaryText,
  },
  firstAxisLabel: {
    left: 0,
    textAlign: 'left',
  },
  lastAxisLabel: {
    right: 0,
    textAlign: 'right',
  },
});
