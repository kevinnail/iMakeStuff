import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { getPieces, type PieceListItem } from '@/db/queries/pieceQueries';
import { formatDay, formatDuration } from '@/utils/formatTime';
import { colors } from '@/theme';
import { getPhotoUri } from '@/utils/photoStorage';

type PieceFilter = 'all' | 'unfinished' | 'finished';

const filters: { value: PieceFilter; label: string; emptyText: string }[] = [
  { value: 'all', label: 'All', emptyText: 'No pieces yet.' },
  { value: 'unfinished', label: 'Unfinished', emptyText: 'No unfinished pieces.' },
  { value: 'finished', label: 'Finished', emptyText: 'No finished pieces.' },
];

export default function PiecesScreen() {
  const [pieces, setPieces] = useState<PieceListItem[]>([]);
  const [filter, setFilter] = useState<PieceFilter>('all');
  const shownPieces = pieces.filter(
    (piece) => filter === 'all' || (filter === 'finished') === (piece.finished_at !== null),
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
      // A row of three joined buttons that picks which pieces the list shows.
      ListHeaderComponent={
        <View style={styles.filterRow}>
          {filters.map(({ value, label }) => (
            <Pressable
              key={value}
              style={[styles.filterButton, filter === value && styles.filterButtonSelected]}
              onPress={() => setFilter(value)}
            >
              <Text style={[styles.filterText, filter === value && styles.filterTextSelected]}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
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
            <Text style={styles.detailText}>
              {piece.finished_at
                ? `Finished ${formatDay(Date.parse(piece.finished_at))}`
                : 'Unfinished'}
            </Text>
            <Text style={styles.detailText}>{formatDuration(piece.worked_milliseconds)}</Text>
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
  filterRow: {
    flexDirection: 'row',
    padding: 2,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  filterButton: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 6,
  },
  filterButtonSelected: {
    backgroundColor: colors.primary,
  },
  filterText: {
    fontSize: 16,
    lineHeight: 18,
    textAlign: 'center',
    color: colors.text,
  },
  filterTextSelected: {
    color: colors.textOnFill,
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
});
