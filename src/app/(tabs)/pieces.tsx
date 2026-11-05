import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Chevron } from '@/components/Chevron';
import { JoinedButtons } from '@/components/JoinedButtons';
import { Tag } from '@/components/Tag';
import { getPieces, type PieceListItem } from '@/db/queries/pieceQueries';
import { formatDay, formatDuration } from '@/utils/formatTime';
import { colors } from '@/theme';
import { getPhotoUri } from '@/utils/photoStorage';

type PieceFilter = 'all' | 'unfinished' | 'finished' | 'lost' | 'prep';

const filters: { value: PieceFilter; label: string; emptyText: string }[] = [
  { value: 'all', label: 'All', emptyText: 'No pieces yet.' },
  { value: 'unfinished', label: 'Working', emptyText: 'No unfinished pieces.' },
  { value: 'finished', label: 'Finished', emptyText: 'No finished pieces.' },
  { value: 'lost', label: 'Lost', emptyText: 'No lost pieces.' },
  { value: 'prep', label: 'Prep', emptyText: 'No prep yet.' },
];

// All covers pieces only, so Prep sits apart from the joined buttons.
const pieceFilters = filters.filter(({ value }) => value !== 'prep');

export default function PiecesScreen() {
  const [pieces, setPieces] = useState<PieceListItem[]>([]);
  const [filter, setFilter] = useState<PieceFilter>('all');
  // Prep shows only under Prep; the other filters list pieces. Finished means finished good.
  const shownPieces = pieces.filter((piece) => {
    if (filter === 'prep') return piece.category === 'prep';
    if (piece.category !== 'piece') return false;
    if (filter === 'unfinished') return piece.finished_at === null;
    if (filter === 'finished') return piece.finished_at !== null && !piece.lost;
    if (filter === 'lost') return piece.lost === 1;
    return true;
  });
  const emptyText = filters.find(({ value }) => value === filter)?.emptyText;

  // Reloads every time the tab is shown, so a piece finished on Work appears here.
  useFocusEffect(
    useCallback(() => {
      getPieces()
        .then(setPieces)
        .catch((error: Error) => Alert.alert('Could not load your pieces', error.message));
    }, []),
  );

  return (
    <FlatList
      data={shownPieces}
      keyExtractor={(piece) => String(piece.id)}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.list}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListHeaderComponent={
        <View style={styles.filterRow}>
          <View style={styles.pieceFilters}>
            <JoinedButtons options={pieceFilters} selected={filter} onSelect={setFilter} />
          </View>
          <Pressable
            style={[styles.prepFilter, filter === 'prep' && styles.prepFilterSelected]}
            onPress={() => setFilter('prep')}
          >
            <Text
              style={[styles.prepFilterText, filter === 'prep' && styles.prepFilterTextSelected]}
            >
              Prep
            </Text>
          </Pressable>
        </View>
      }
      ListEmptyComponent={<Text style={styles.detailText}>{emptyText}</Text>}
      renderItem={({ item: piece }) => (
        <Pressable
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          onPress={() => router.push({ pathname: '/piece/[id]', params: { id: piece.id } })}
        >
          {piece.photo_file_name ? (
            <Image source={{ uri: getPhotoUri(piece.photo_file_name) }} style={styles.photo} />
          ) : (
            <View style={styles.photo} />
          )}
          <View style={styles.details}>
            <View style={styles.nameRow}>
              <Text style={styles.name}>{piece.name}</Text>
              {piece.lost === 1 && <Tag label="Lost" />}
            </View>
            <View style={styles.bottomRow}>
              <Text style={[styles.detailText, styles.dateText]}>
                {piece.finished_at
                  ? `${piece.lost ? 'Lost' : 'Finished'} ${formatDay(Date.parse(piece.finished_at))}`
                  : 'Unfinished'}
              </Text>
              <View style={styles.timeColumn}>
                <Text style={styles.detailText}>Worked</Text>
                <Text style={styles.timeValue}>{formatDuration(piece.worked_milliseconds)}</Text>
              </View>
              {piece.prep_milliseconds !== null && (
                <View style={styles.timeColumn}>
                  <Text style={styles.detailText}>
                    {piece.prep_estimated ? 'Prep, est.' : 'Prep'}
                  </Text>
                  <Text style={styles.timeValue}>{formatDuration(piece.prep_milliseconds)}</Text>
                </View>
              )}
            </View>
          </View>
          <Chevron />
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    padding: 16,
    gap: 12,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 12,
  },
  pieceFilters: {
    flex: 1,
  },
  // Sized to match a joined button: its 6 of padding plus the row's 2.
  prepFilter: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  prepFilterSelected: {
    backgroundColor: colors.prep,
  },
  prepFilterText: {
    fontSize: 14,
    lineHeight: 18,
    color: colors.text,
  },
  prepFilterTextSelected: {
    color: colors.textOnFill,
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
  rowPressed: {
    opacity: 0.6,
  },
  photo: {
    width: 72,
    height: 72,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  details: {
    flex: 1,
    gap: 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  name: {
    flexShrink: 1,
    fontSize: 20,
    color: colors.text,
  },
  detailText: {
    fontSize: 16,
    color: colors.secondaryText,
  },
  // Under the full-width name: the date on the left, the times on the right.
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
  },
  dateText: {
    flex: 1,
  },
  // A label over its time, right-aligned so the times line up from row to row.
  timeColumn: {
    alignItems: 'flex-end',
    gap: 2,
  },
  timeValue: {
    fontSize: 18,
    fontVariant: ['tabular-nums'],
    color: colors.text,
  },
});
