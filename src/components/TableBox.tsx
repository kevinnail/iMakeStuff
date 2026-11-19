import type { ReactNode } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme';

export interface TableColumn {
  label: string;
  value: string;
  // A value that marks the record as missing something, like No cost, in the warning color.
  warning?: boolean;
}

interface TableBoxProps {
  title: string;
  // Small tags after the title, like Lost or No cost.
  tags?: ReactNode;
  // At the right end of the title row: a date, Unfinished, or Estimated.
  titleNote?: string;
  columns: TableColumn[];
  // A photo down the box's left edge. A null uri draws the shaded block of a piece with none.
  photo?: { uri: string | null };
}

// One record as a box: a shaded title row with its name, over a small table whose column names
// sit over their values. Each column takes an equal share of the width with its text centered, so
// boxes with the same columns line up down a list. As wide as its row; nothing in it shrinks but
// the title, which ends in "…".
export function TableBox({ title, tags, titleNote, columns, photo }: TableBoxProps) {
  return (
    <View style={styles.box}>
      {photo &&
        (photo.uri ? (
          <Image source={{ uri: photo.uri }} style={styles.photo} />
        ) : (
          <View style={styles.photo} />
        ))}
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {tags}
          {titleNote && titleNote === 'Unfinished' ? (
            <Text style={styles.titleNoteUnfinished}>{titleNote}</Text>
          ) : (
            <Text style={styles.titleNote}>{titleNote}</Text>
          )}
        </View>
        <View style={styles.columns}>
          {columns.map(({ label, value, warning }, index) => (
            <View key={label} style={[styles.column, index > 0 && styles.columnLine]}>
              <Text style={styles.label}>{label}</Text>
              <Text style={[styles.value, warning && styles.valueWarning]}>{value}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flex: 1,
    flexDirection: 'row',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.secondaryText,
    borderRadius: 6,
  },
  // Flush with the box's top, bottom, and left edges, as tall as the box.
  photo: {
    width: 72,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.secondaryText,
    backgroundColor: colors.surface,
  },
  body: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.secondaryText,
    backgroundColor: colors.surface,
  },
  title: {
    flexShrink: 1,
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  // At the right end of the title row, at its full width.
  titleNote: {
    marginLeft: 'auto',
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  titleNoteUnfinished: {
    marginLeft: 'auto',
    fontSize: 14,
    color: colors.warning,
  },
  columns: {
    flexDirection: 'row',
  },
  column: {
    flex: 1,
    alignItems: 'center',
  },
  columnLine: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.secondaryText,
  },
  // Smaller than the rest of a row so three columns fit beside a photo on the narrowest iPhone.
  label: {
    alignSelf: 'stretch',
    textAlign: 'center',
    paddingVertical: 2,
    fontSize: 14,
    color: colors.secondaryText,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.secondaryText,
  },
  value: {
    paddingVertical: 2,
    fontSize: 14,
    fontVariant: ['tabular-nums'],
    color: colors.secondaryText,
  },
  valueWarning: {
    color: colors.warning,
  },
});
