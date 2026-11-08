import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Chevron } from '@/components/Chevron';
import { JoinedButtons } from '@/components/JoinedButtons';
import { AssignedBar } from '@/components/AssignedBar';
import { Tag } from '@/components/Tag';
import { getPieces, type PieceListItem } from '@/db/queries/pieceQueries';
import { useGuideStore } from '@/store/guideStore';
import { formatCost } from '@/utils/cost';
import { formatDay, formatDuration } from '@/utils/formatTime';
import { colors, guideOutline } from '@/theme';
import { getPhotoUri } from '@/utils/photoStorage';

type Section = 'work' | 'prep';

type PieceFilter = 'all' | 'unfinished' | 'finished' | 'lost';

const pieceFilters: { value: PieceFilter; label: string; emptyText: string }[] = [
  { value: 'all', label: 'All', emptyText: 'No pieces yet.' },
  { value: 'unfinished', label: 'Working', emptyText: 'No unfinished pieces.' },
  { value: 'finished', label: 'Finished', emptyText: 'No finished pieces.' },
  { value: 'lost', label: 'Lost', emptyText: 'No lost pieces.' },
];

// A counted prep shows what it made; a by eye one, how much of its cost is assigned.
function PrepLeft({ prep }: { prep: PieceListItem }) {
  if (!prep.finished_at) return <Text style={styles.detailText}>Unfinished</Text>;
  if (prep.size_amount !== null) {
    return (
      <Text style={styles.detailText}>
        {prep.size_amount} {prep.size_unit}
      </Text>
    );
  }
  if (prep.lost) return null;
  return <AssignedBar usedShare={prep.used_share} usedUp={prep.used_up === 1} />;
}

export default function PiecesScreen() {
  const guideTarget = useGuideStore((state) => state.target);
  const [pieces, setPieces] = useState<PieceListItem[]>([]);
  const [section, setSection] = useState<Section>('work');
  const [filter, setFilter] = useState<PieceFilter>('all');
  // Prep shows only under Prep; Work lists pieces by its filter. Finished means finished good.
  const shownPieces = pieces.filter((piece) => {
    if (section === 'prep') return piece.category === 'prep';
    if (piece.category !== 'piece') return false;
    if (filter === 'unfinished') return piece.finished_at === null;
    if (filter === 'finished') return piece.finished_at !== null && !piece.lost;
    if (filter === 'lost') return piece.lost === 1;
    return true;
  });
  const listedPieces =
    section === 'prep'
      ? [...shownPieces].sort((first, second) => second.usable - first.usable)
      : shownPieces;
  const emptyText =
    section === 'prep'
      ? 'No prep yet.'
      : pieceFilters.find(({ value }) => value === filter)?.emptyText;

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
      data={listedPieces}
      keyExtractor={(piece) => String(piece.id)}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.list}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListHeaderComponent={
        <View style={styles.header}>
          <View style={styles.sectionRow}>
            <Pressable
              style={[styles.sectionButton, section === 'work' && styles.workSelected]}
              onPress={() => setSection('work')}
            >
              <Text style={[styles.buttonText, section === 'work' && styles.buttonTextSelected]}>
                Work
              </Text>
            </Pressable>
            <Pressable
              style={[styles.sectionButton, section === 'prep' && styles.prepSelected]}
              onPress={() => setSection('prep')}
            >
              <Text style={[styles.buttonText, section === 'prep' && styles.buttonTextSelected]}>
                Prep
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.sectionButton,
                styles.suppliesButton,
                guideTarget === 'supplies' && guideOutline,
                pressed && styles.rowPressed,
              ]}
              onPress={() => router.push('/supplies')}
            >
              <Text style={styles.buttonText}>Supplies</Text>
              <Chevron />
            </Pressable>
          </View>
          {section === 'work' && (
            <JoinedButtons options={pieceFilters} selected={filter} onSelect={setFilter} />
          )}
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
              {piece.no_cost === 1 && <Tag label="No cost" warning />}
            </View>
            {piece.category === 'prep' ? (
              <>
                <PrepLeft prep={piece} />
                <View style={styles.bottomRow}>
                  <View style={[styles.dateText, styles.inlineRow]}>
                    {piece.lost === 1 && <Tag label="Lost" />}
                    <Text style={styles.detailText}>
                      {piece.finished_at
                        ? `${piece.lost ? '' : 'Made '}${formatDay(Date.parse(piece.finished_at))}`
                        : ''}
                    </Text>
                  </View>
                  <Text style={styles.detailText}>
                    {formatDuration(piece.worked_milliseconds)} worked
                  </Text>
                </View>
              </>
            ) : (
              <View style={styles.bottomRow}>
                <View style={[styles.dateText, styles.dateColumn]}>
                  {piece.finished_at ? (
                    <>
                      {piece.lost ? (
                        <Tag label="Lost" />
                      ) : (
                        <Text style={styles.detailText}>Finished</Text>
                      )}
                      <Text style={styles.timeValue}>
                        {formatDay(Date.parse(piece.finished_at))}
                      </Text>
                    </>
                  ) : (
                    <Text style={styles.detailText}>Unfinished</Text>
                  )}
                </View>
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
                {piece.cost_cents !== null && (
                  <View style={styles.timeColumn}>
                    <Text style={styles.detailText}>
                      {piece.cost_estimated ? 'Cost, est.' : 'Cost'}
                    </Text>
                    <Text style={styles.timeValue}>{formatCost(piece.cost_cents)}</Text>
                  </View>
                )}
              </View>
            )}
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
  header: {
    gap: 12,
  },
  sectionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  // As tall as the joined buttons below: their 6 of padding plus the row's 2, around 18 of text.
  sectionButton: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  // The arrow's 24 line height takes 6 off the padding, so it stays as tall as Work and Prep.
  suppliesButton: {
    paddingVertical: 5,
  },
  workSelected: {
    backgroundColor: colors.primary,
  },
  prepSelected: {
    backgroundColor: colors.prep,
  },
  buttonText: {
    fontSize: 14,
    lineHeight: 18,
    color: colors.text,
  },
  buttonTextSelected: {
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
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
  },
  dateText: {
    flex: 1,
  },
  dateColumn: {
    alignItems: 'flex-start',
    gap: 2,
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
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
