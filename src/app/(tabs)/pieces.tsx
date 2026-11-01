import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { getPieces, type PieceListItem } from '@/db/queries/pieceQueries';
import { formatDay, formatDuration } from '@/utils/formatTime';
import { getPhotoUri } from '@/utils/photoStorage';

export default function PiecesScreen() {
  const [pieces, setPieces] = useState<PieceListItem[]>([]);

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
      data={pieces}
      keyExtractor={(piece) => String(piece.id)}
      contentContainerStyle={styles.list}
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  photo: {
    width: 72,
    height: 72,
    borderRadius: 8,
    backgroundColor: '#eee',
  },
  details: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: 20,
  },
  detailText: {
    fontSize: 16,
    color: '#555',
  },
});
