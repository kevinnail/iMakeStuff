import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Chevron } from '@/components/Chevron';
import { JoinedButtons } from '@/components/JoinedButtons';
import { AssignedBar } from '@/components/AssignedBar';
import { getDeleteMessage } from '@/components/PieceEditForm';
import { SwipeRow } from '@/components/SwipeRow';
import { TableBox } from '@/components/TableBox';
import { Tag } from '@/components/Tag';
import { getPieces, type PieceListItem } from '@/db/queries/pieceQueries';
import { useGuideStore, useGuideTarget, type GuideTarget } from '@/store/guideStore';
import { useWorkStore } from '@/store/workStore';
import { formatCost } from '@/utils/cost';
import { formatDay, formatDuration } from '@/utils/formatTime';
import { colors } from '@/theme';
import { getPhotoUri } from '@/utils/photoStorage';
import { showError } from '@/utils/showError';

type Section = 'work' | 'prep';

// The guide's two steps on the Add Work button show it under the section each is about: blue for
// pieces, green for prep.
const guideSections: Partial<Record<GuideTarget, Section>> = { addWork: 'work', addPrep: 'prep' };

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

// A piece as one box: its photo, a title row with its name and date, and a table of Worked,
// Prep, and Cost. Every piece has all three columns so they line up down the list; one with no
// prep or cost shows " - " there.
function PieceTable({ piece }: { piece: PieceListItem }) {
  const columns = [
    { label: 'Worked', value: formatDuration(piece.worked_milliseconds) },
    {
      label: piece.prep_estimated ? 'Prep, est.' : 'Prep',
      value: piece.prep_milliseconds === null ? ' - ' : formatDuration(piece.prep_milliseconds),
    },
    {
      label: piece.cost_estimated ? 'Cost, est.' : 'Cost',
      value: piece.cost_cents === null ? ' - ' : formatCost(piece.cost_cents),
    },
  ];

  // A date means the piece is finished.
  return (
    <TableBox
      title={piece.name}
      tags={
        <>
          {piece.lost === 1 && <Tag label="Lost" />}
          {piece.no_cost === 1 && <Tag label="No cost" warning />}
        </>
      }
      titleNote={piece.finished_at ? formatDay(Date.parse(piece.finished_at)) : 'Unfinished'}
      columns={columns}
      photo={{ uri: piece.photo_file_name ? getPhotoUri(piece.photo_file_name) : null }}
    />
  );
}

export default function PiecesScreen() {
  const { ref: suppliesRef, measure: measureSupplies } = useGuideTarget('supplies');
  const { ref: addWorkRef, measure: measureAddWork } = useGuideTarget('addWork', 'addPrep');
  const guideSection = useGuideStore((state) =>
    state.target ? guideSections[state.target] : undefined,
  );
  // Through the Work store, so deleting the running piece also clears it from the Lock Screen.
  const remove = useWorkStore((state) => state.remove);
  const [pieces, setPieces] = useState<PieceListItem[]>([]);
  const [chosenSection, setSection] = useState<Section>('work');
  const [filter, setFilter] = useState<PieceFilter>('all');
  // The guide's section while it points at the Add Work button, then back to the one chosen.
  const section = guideSection ?? chosenSection;
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

  // Both guide outlines move with the list.
  function measureTargets() {
    measureSupplies();
    measureAddWork();
  }

  const load = useCallback(() => getPieces().then(setPieces), []);

  // Reloads every time the tab is shown, so a piece finished on Work appears here.
  useFocusEffect(
    useCallback(() => {
      load().catch((error: Error) => Alert.alert('Could not load your pieces', error.message));
    }, [load]),
  );

  // The same box as Delete on the piece's page.
  function confirmDelete(piece: PieceListItem) {
    Alert.alert(
      `Delete ${piece.name}?`,
      getDeleteMessage(piece.worked_milliseconds, piece.used_by_count),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => remove(piece.id).then(load).catch(showError('Could not delete the piece')),
        },
      ],
    );
  }

  return (
    <FlatList
      data={listedPieces}
      keyExtractor={(piece) => String(piece.id)}
      contentInsetAdjustmentBehavior="automatic"
      onScroll={measureTargets}
      // Work's pieces are boxes with their own borders, so they sit close with no line between.
      contentContainerStyle={[styles.list, section === 'work' && styles.workList]}
      ItemSeparatorComponent={
        section === 'prep' ? () => <View style={styles.separator} /> : undefined
      }
      ListHeaderComponent={
        <View style={[styles.header, section === 'work' && styles.workHeader]}>
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
              ref={suppliesRef}
              onLayout={measureSupplies}
              style={({ pressed }) => [
                styles.sectionButton,
                styles.suppliesButton,
                pressed && styles.rowPressed,
              ]}
              onPress={() => router.push('/supplies')}
            >
              <Text style={styles.buttonText}>Supplies</Text>
              <Chevron />
            </Pressable>
          </View>
          <Pressable
            ref={addWorkRef}
            onLayout={measureAddWork}
            style={({ pressed }) => [
              styles.addButton,
              section === 'prep' && styles.prepSelected,
              pressed && styles.rowPressed,
            ]}
            onPress={() =>
              router.push({
                pathname: '/add-work',
                params: { category: section === 'prep' ? 'prep' : 'piece' },
              })
            }
          >
            <Text style={styles.addButtonText}>Add Work</Text>
          </Pressable>
          {section === 'work' && (
            <JoinedButtons options={pieceFilters} selected={filter} onSelect={setFilter} />
          )}
        </View>
      }
      ListEmptyComponent={<Text style={styles.detailText}>{emptyText}</Text>}
      renderItem={({ item: piece }) => (
        <SwipeRow
          actions={[
            {
              label: 'Delete',
              icon: 'trash.fill',
              color: colors.danger,
              onPress: () => confirmDelete(piece),
            },
          ]}
          backgroundColor={colors.background}
        >
          <Pressable
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            onPress={() => router.push({ pathname: '/piece/[id]', params: { id: piece.id } })}
          >
            {piece.category === 'prep' ? (
              <>
                {piece.photo_file_name ? (
                  <Image
                    source={{ uri: getPhotoUri(piece.photo_file_name) }}
                    style={styles.photo}
                  />
                ) : (
                  <View style={styles.photo} />
                )}
                <View style={styles.details}>
                  <View style={styles.nameRow}>
                    <Text style={styles.name} numberOfLines={1}>
                      {piece.name}
                    </Text>
                    {piece.no_cost === 1 && <Tag label="No cost" warning />}
                  </View>
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
                </View>
              </>
            ) : (
              <PieceTable piece={piece} />
            )}
            <Chevron />
          </Pressable>
        </SwipeRow>
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
  workList: {
    gap: 12,
  },
  workHeader: {
    marginBottom: 6,
  },
  // The width of the list, blue under Work and green under Prep, like the selected button below.
  addButton: {
    alignItems: 'center',
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
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});
