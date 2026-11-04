import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { JoinedButtons } from '@/components/JoinedButtons';
import { getPieces, type PieceListItem } from '@/db/queries/pieceQueries';
import { formatDay, formatDuration } from '@/utils/formatTime';
import { colors } from '@/theme';
import { getPhotoUri } from '@/utils/photoStorage';

type PieceFilter = 'all' | 'unfinished' | 'finished' | 'prep';

const filters: { value: PieceFilter; label: string; emptyText: string }[] = [
  { value: 'all', label: 'All', emptyText: 'No pieces yet.' },
  { value: 'unfinished', label: 'Working', emptyText: 'No unfinished pieces.' },
  { value: 'finished', label: 'Finished', emptyText: 'No finished pieces.' },
  { value: 'prep', label: 'Prep', emptyText: 'No prep yet.' },
];

export default function PiecesScreen() {
  const [pieces, setPieces] = useState<PieceListItem[]>([]);
  const [filter, setFilter] = useState<PieceFilter>('all');
  // Prep shows only under Prep; the other filters list pieces.
  const shownPieces = pieces.filter((piece) =>
    filter === 'prep'
      ? piece.category === 'prep'
      : piece.category === 'piece' &&
        (filter === 'all' || (filter === 'finished') === (piece.finished_at !== null)),
  );
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
        <JoinedButtons options={filters} selected={filter} onSelect={setFilter} />
      }
      ListEmptyComponent={<Text style={styles.detailText}>{emptyText}</Text>}
      renderItem={({ item: piece }) => (
        <Pressable
          style={styles.row}
          onPress={() => router.push({ pathname: '/piece/[id]', params: { id: piece.id } })}
        >
          {piece.photo_file_name ? (
            <Image source={{ uri: getPhotoUri(piece.photo_file_name) }} style={styles.photo} />
          ) : (
            <View style={styles.photo} />
          )}
          <View style={styles.details}>
            <Text style={styles.name}>{piece.name}</Text>
            <View style={styles.bottomRow}>
              <Text style={[styles.detailText, styles.dateText]}>
                {piece.finished_at
                  ? `Finished ${formatDay(Date.parse(piece.finished_at))}`
                  : 'Unfinished'}
              </Text>
              <View style={styles.timeColumn}>
                <Text style={styles.detailText}>Worked</Text>
                <Text style={styles.timeValue}>{formatDuration(piece.worked_milliseconds)}</Text>
              </View>
              {piece.prep_milliseconds !== null && (
                <View style={styles.timeColumn}>
                  <Text style={styles.detailText}>Prep, est.</Text>
                  <Text style={styles.timeValue}>{formatDuration(piece.prep_milliseconds)}</Text>
                </View>
              )}
            </View>
          </View>
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
  name: {
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
