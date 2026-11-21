import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { Card } from '@/components/Card';
import { Chevron } from '@/components/Chevron';
import { EntryTimesPanel } from '@/components/EntryTimesPanel';
import { NewPrepPanel } from '@/components/NewPrepPanel';
import { PieceEditForm } from '@/components/PieceEditForm';
import { AssignedBar } from '@/components/AssignedBar';
import { StarRating } from '@/components/StarRating';
import { TableBox, type TableColumn } from '@/components/TableBox';
import { Tag } from '@/components/Tag';
import {
  getSavedChoice,
  UsePanel,
  useLabels,
  type AvailableItem,
  type UseKind,
} from '@/components/UsePanel';
import { addPieceTime } from '@/db/queries/entryQueries';
import { useWorkStore } from '@/store/workStore';
import {
  getPieceDetail,
  setPieceLost,
  setPieceRating,
  setPieceTemplate,
  type PieceCategory,
  type PieceRecord,
  type PieceSegment,
} from '@/db/queries/pieceQueries';
import {
  addPrepUse,
  addSupplyUse,
  changePrepUse,
  getAvailablePrep,
  removePrepUse,
  setPrepUsedUp,
  type PieceUsingPrep,
  type UsedPrep,
} from '@/db/queries/prepQueries';
import {
  changeSupplyUse,
  getAvailableSupplies,
  removeSupplyUse,
  type UsedSupply,
} from '@/db/queries/supplyQueries';
import { formatCost, getCost } from '@/utils/cost';
import { formatClockTime, formatDay, formatDuration } from '@/utils/formatTime';
import {
  formatAmount,
  formatPercent,
  formatShare,
  getActualShare,
  getPrepTime,
  getShareValue,
  groupByPiece,
  type BatchSize,
  type Share,
} from '@/utils/prepTime';
import { getWorkDays, type WorkDay } from '@/utils/workDays';
import { getPhotoUri } from '@/utils/photoStorage';
import { colors } from '@/theme';
import { showError } from '@/utils/showError';

interface PiecePage {
  piece: PieceRecord;
  segments: PieceSegment[];
  // A running segment counts up to when the page loaded.
  loadedAt: number;
  days: WorkDay[];
  // When the running piece or break started, or null with nothing running.
  runningSince: string | null;
  usedPrep: UsedPrep[];
  usedBy: PieceUsingPrep[];
  usedSupplies: UsedSupply[];
}

type PrepTime = ReturnType<typeof getPrepTime<UsedPrep>>;

type Cost = ReturnType<typeof getCost<UsedSupply, UsedPrep>>;

interface TotalsProps {
  days: WorkDay[];
  prepTime: PrepTime;
  cost: Cost;
  // Unfinished or Lost, beside the total.
  tag: string | null;
  noCost: boolean;
}

interface UseLine {
  use: Share & { id: number };
  item: { id: number; name: string } & BatchSize;
  // At the right of the name: Estimated or Actual on a by eye prep, nothing on an exact share.
  note: string | undefined;
  // How much was used, then what it adds to the piece.
  columns: TableColumn[];
}

interface UseQueries {
  getAvailable: () => Promise<AvailableItem[]>;
  add: (itemId: number, share: Share) => Promise<void>;
  change: (useId: number, share: Share) => Promise<void>;
  remove: (useId: number) => Promise<void>;
}

interface UsesSectionProps {
  kind: UseKind;
  usedBy: PieceCategory;
  lines: UseLine[];
  uses: UseQueries;
  onChange: () => Promise<void>;
}

interface UsedByProps {
  usedBy: PieceUsingPrep[];
  usedUp: boolean;
  size: BatchSize;
}

type DayField = 'worked' | 'otherPieces' | 'onBreak';

const dayColumns: { label: string; field: DayField }[] = [
  { label: 'Worked', field: 'worked' },
  { label: 'Break', field: 'onBreak' },
  { label: 'Other pieces', field: 'otherPieces' },
];

function sumDays(days: WorkDay[], field: DayField) {
  return days.reduce((total, day) => total + day[field], 0);
}

// Add time starts on the hour just past, the likeliest stretch to have gone unrecorded. With
// something running, the hour ends where it started, so it doesn't overlap it.
function getLastHour(runningSince: string | null) {
  const endedAt = runningSince ? Date.parse(runningSince) : Date.now();
  return { startedAt: endedAt - 60 * 60 * 1000, endedAt };
}

// The whole piece: its total time large (its own time plus its share of prep), when it was
// worked, then a card of what the total is made of and where the rest of the time went. A piece
// whose only entry ended at its own start (I stopped at, or a time fix) has no days, so no when.
function Totals({ days, prepTime, cost, tag, noCost }: TotalsProps) {
  const firstDay = days[0];
  const lastDay = days[days.length - 1];
  const when =
    days.length === 0
      ? null
      : days.length === 1
        ? `${formatDay(firstDay.dayStart)}, ${formatClockTime(firstDay.firstStart)} to ${formatClockTime(firstDay.lastStop)}`
        : `${formatDay(firstDay.dayStart)} to ${formatDay(lastDay.dayStart)}, ${days.length} days`;
  const usedPrep = prepTime.lines.length > 0;
  const prepRows = [
    { label: 'On the piece', value: formatDuration(sumDays(days, 'worked')) },
    {
      label: prepTime.estimated ? 'Prep, estimated' : 'Prep',
      value: formatDuration(prepTime.prep),
    },
  ];
  const costRow = {
    label: cost.estimated ? 'Supplies, estimated' : 'Supplies',
    value: formatCost(cost.cents),
  };
  const rows = [
    ...(usedPrep ? prepRows : []),
    { label: 'Break', value: formatDuration(sumDays(days, 'onBreak')) },
    { label: 'Other pieces', value: formatDuration(sumDays(days, 'otherPieces')) },
    ...(cost.hasSupplies ? [costRow] : []),
  ];

  return (
    <>
      <View style={styles.totalHeader}>
        <View style={styles.inlineRow}>
          <Text style={[styles.totalLine, styles.fill]}>
            <Text style={styles.totalTime}>{formatDuration(prepTime.total)}</Text> total
            {prepTime.estimated && ', estimated'}
          </Text>
          {tag && <Tag label={tag} />}
          {noCost && <Tag label="No cost" warning />}
        </View>
        {when && <Text style={styles.secondaryText}>{when}</Text>}
      </View>
      <Card>
        {rows.map(({ label, value }) => (
          <View key={label} style={styles.row}>
            <Text style={[styles.text, styles.fill]}>{label}</Text>
            <Text style={styles.value}>{value}</Text>
          </View>
        ))}
      </Card>
    </>
  );
}

// One line per day, so a piece worked over many days still fits on one screen. Built column by
// column, so each column is as wide as its widest text and no cell wraps. The Day column also
// takes any width left over.
function DayTable({ days }: { days: WorkDay[] }) {
  return (
    <Card>
      <View style={styles.dayTable}>
        <View style={styles.dayColumn}>
          <Text style={[styles.secondaryText, styles.tableCell]}>Day</Text>
          {days.map((day) => (
            <Text
              key={day.dayStart}
              style={[styles.tableValue, styles.tableCell, styles.tableLine]}
            >
              {formatDay(day.dayStart)}
            </Text>
          ))}
        </View>
        {dayColumns.map(({ label, field }) => (
          <View key={field}>
            <Text style={[styles.secondaryText, styles.tableCell, styles.durationCell]}>
              {label}
            </Text>
            {days.map((day) => (
              <Text
                key={day.dayStart}
                style={[styles.tableValue, styles.tableCell, styles.durationCell, styles.tableLine]}
              >
                {formatDuration(day[field])}
              </Text>
            ))}
          </View>
        ))}
      </View>
    </Card>
  );
}

// The heading, then a box per use, the same as a piece on the Pieces tab: its name, then how much
// was used and what it adds to the piece (prep time and cost, or a supply's cost). Tapping one
// changes or removes it. Add prep or Add supply comes last, the same as on Add Work.
function UsesSection({ kind, usedBy, lines, uses, onChange }: UsesSectionProps) {
  const labels = useLabels[kind];
  const [itemList, setItemList] = useState<AvailableItem[] | null>(null);
  const [changingLine, setChangingLine] = useState<UseLine | null>(null);

  function save(change: Promise<void>) {
    setItemList(null);
    setChangingLine(null);
    change.then(onChange).catch(showError('Could not save the change'));
  }

  function openItemList() {
    uses.getAvailable().then(setItemList).catch(showError('Could not load the list'));
  }

  // A new price is saved even if the panel is canceled, so the page shows it right away.
  function reload() {
    onChange().catch(showError('Could not load the piece'));
  }

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>{labels.heading}</Text>
      {lines.length === 0 && <Text style={styles.secondaryText}>{labels.noneAdded}</Text>}
      {lines.map((line) => (
        <Pressable
          key={line.use.id}
          style={({ pressed }) => [styles.useRow, pressed && styles.buttonPressed]}
          onPress={() => setChangingLine(line)}
        >
          <TableBox title={line.item.name} titleNote={line.note} columns={line.columns} />
          <Chevron />
        </Pressable>
      ))}
      <Pressable
        style={({ pressed }) => [styles.addRow, pressed && styles.buttonPressed]}
        onPress={openItemList}
      >
        <Text style={styles.addText}>{labels.add}</Text>
      </Pressable>
      {itemList && (
        <UsePanel
          kind={kind}
          usedBy={usedBy}
          itemList={itemList}
          initial={null}
          onCancel={() => setItemList(null)}
          onSave={({ item, share }) => save(uses.add(item.id, share))}
          onRepriced={reload}
          renderNewPrep={(handlers) => <NewPrepPanel {...handlers} />}
        />
      )}
      {changingLine && (
        <UsePanel
          kind={kind}
          usedBy={usedBy}
          itemList={null}
          initial={getSavedChoice(changingLine.use, changingLine.item)}
          onCancel={() => setChangingLine(null)}
          onSave={({ share }) => save(uses.change(changingLine.use.id, share))}
          onRemove={() => save(uses.remove(changingLine.use.id))}
        />
      )}
    </View>
  );
}

// A prep's uses: each piece's estimate, and once the prep is all used, what it really took. A
// counted prep's pieces carry their own exact amounts, so it lists only the pieces.
function UsedBy({ usedBy, usedUp, size }: UsedByProps) {
  const rows = usedBy.map((use) => ({ ...use, actual_share: getActualShare(use) }));
  const estimatedTotal = rows.reduce((total, row) => total + getShareValue(row), 0);
  const actualTotal = rows.reduce((total, row) => total + row.actual_share, 0);

  function openPiece(pieceId: number) {
    router.push({ pathname: '/piece/[id]', params: { id: pieceId } });
  }

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>Used by</Text>
      {rows.length === 0 ? (
        <Card>
          <View style={styles.row}>
            <Text style={styles.secondaryText}>No pieces have used it yet.</Text>
          </View>
        </Card>
      ) : size.size_amount !== null ? (
        <Card>
          {rows.map((row) => (
            <Pressable
              key={row.id}
              style={({ pressed }) => [styles.row, pressed && styles.buttonPressed]}
              onPress={() => openPiece(row.piece_id)}
            >
              <Text style={[styles.tableValue, styles.fill]}>{row.piece_name}</Text>
              <Chevron />
            </Pressable>
          ))}
        </Card>
      ) : (
        <Card>
          <View style={styles.row}>
            <Text style={[styles.secondaryText, styles.fill]}>Piece</Text>
            <Text style={[styles.secondaryText, styles.numberColumn, styles.estimatedColumn]}>
              Estimated
            </Text>
            {usedUp && (
              <Text style={[styles.secondaryText, styles.numberColumn, styles.actualColumn]}>
                Actual
              </Text>
            )}
            <View style={styles.chevronColumn} />
          </View>
          {rows.map((row) => (
            <Pressable
              key={row.id}
              style={({ pressed }) => [styles.row, pressed && styles.buttonPressed]}
              onPress={() => openPiece(row.piece_id)}
            >
              <Text style={[styles.tableValue, styles.fill]}>{row.piece_name}</Text>
              <Text style={[styles.tableValue, styles.numberColumn, styles.estimatedColumn]}>
                {formatShare(row)}
              </Text>
              {usedUp && (
                <Text style={[styles.tableValue, styles.numberColumn, styles.actualColumn]}>
                  {formatPercent(row.actual_share)}
                </Text>
              )}
              <View style={styles.chevronColumn}>
                <Chevron />
              </View>
            </Pressable>
          ))}
          <View style={styles.row}>
            <Text style={[styles.secondaryText, styles.fill]}>Total</Text>
            <Text style={[styles.tableValue, styles.numberColumn, styles.estimatedColumn]}>
              {formatPercent(estimatedTotal)}
            </Text>
            {usedUp && (
              <Text style={[styles.tableValue, styles.numberColumn, styles.actualColumn]}>
                {formatPercent(actualTotal)}
              </Text>
            )}
            <View style={styles.chevronColumn} />
          </View>
        </Card>
      )}
    </View>
  );
}

export default function PieceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pieceId = Number(id);
  // Through the Work store, so the piece shows on Work and the Lock Screen right away.
  const workAgain = useWorkStore((state) => state.workAgain);
  // undefined while loading, null when no piece has this id.
  const [page, setPage] = useState<PiecePage | null>();
  const [photoAspectRatio, setPhotoAspectRatio] = useState(3 / 4);
  const [editing, setEditing] = useState(false);
  const [addingTime, setAddingTime] = useState<{ startedAt: number; endedAt: number } | null>(null);

  const load = useCallback(
    () =>
      getPieceDetail(pieceId).then((detail) => {
        const loadedAt = Date.now();
        setPage(
          detail && {
            piece: detail.piece,
            segments: detail.segments,
            loadedAt,
            days: getWorkDays(detail.segments, detail.otherSegments, detail.breaks, loadedAt),
            runningSince:
              [...detail.segments, ...detail.otherSegments, ...detail.breaks].find(
                (entry) => entry.ended_at === null,
              )?.started_at ?? null,
            usedPrep: detail.usedPrep,
            usedBy: detail.usedBy,
            usedSupplies: detail.usedSupplies,
          },
        );
      }),
    [pieceId],
  );

  // Reloads whenever the page is shown, so a use changed on a piece opened from here shows.
  useFocusEffect(
    useCallback(() => {
      load().catch(showError('Could not load the piece'));
    }, [load]),
  );

  if (page === undefined) return null;
  if (page === null) return <Text style={styles.text}>No piece with this id.</Text>;

  const { piece, segments, loadedAt, days, runningSince, usedPrep, usedBy, usedSupplies } = page;
  const prepByPiece = groupByPiece(usedPrep);
  const prepTime = getPrepTime(piece.id, sumDays(days, 'worked'), prepByPiece);
  const cost = getCost(piece.id, prepByPiece, groupByPiece(usedSupplies));
  const finishedPrep = piece.category === 'prep' && piece.finished_at !== null;
  // Only prep has a count.
  const partCount = piece.size_amount;
  const finishedByEyePrep = finishedPrep && partCount === null;
  // A run's shares are exact prices, so they aren't assigned. On a by eye prep, those are the
  // measured ones.
  const usedShare = usedBy
    .filter((use) => !use.measured)
    .reduce((total, use) => total + getShareValue(use), 0);
  // Every use carries whether its uses have closed the prep, so the page follows the same rule.
  const usedUp = piece.used_up_at !== null || usedBy.some((use) => use.used_up === 1);

  // A counted prep's share is exact, and so is a run's, so it needs no mark. A by eye one is a
  // guess until it's all used, then shows what it really took.
  const prepLines = prepTime.lines.map((line, index): UseLine => {
    const costLine = cost.prepLines[index];
    const item = {
      id: line.prep_id,
      name: line.prep_name,
      size_amount: line.size_amount,
      size_unit: line.size_unit,
    };
    const guessed = !line.measured;
    return {
      use: line,
      item,
      note: guessed ? (line.used_up ? 'Actual' : 'Estimated') : undefined,
      columns: [
        {
          label: 'Used',
          value:
            guessed && line.used_up
              ? formatPercent(getActualShare(line))
              : formatAmount(line, item),
        },
        { label: 'Time', value: formatDuration(line.milliseconds) },
        { label: 'Cost', value: costLine.hasSupplies ? formatCost(costLine.cents) : ' - ' },
      ],
    };
  });
  const supplyLines = cost.supplyLines.map((line): UseLine => {
    const item = {
      id: line.supply_id,
      name: line.supply_name,
      size_amount: line.size_amount,
      size_unit: line.size_unit,
    };
    return {
      use: line,
      item,
      note: undefined,
      columns: [
        { label: 'Used', value: formatAmount(line, item) },
        { label: 'Cost', value: formatCost(line.cents) },
      ],
    };
  });
  const prepQueries: UseQueries = {
    getAvailable: () => getAvailablePrep(piece.id),
    add: (prepId, share) => addPrepUse(piece.id, { prepId, share }),
    change: changePrepUse,
    remove: removePrepUse,
  };
  const supplyQueries: UseQueries = {
    getAvailable: () => getAvailableSupplies(piece.id),
    add: (supplyId, share) => addSupplyUse(piece.id, { supplyId, share }),
    change: changeSupplyUse,
    remove: removeSupplyUse,
  };

  async function saveAddedTime(startedAt: number, endedAt: number | null) {
    await addPieceTime(
      piece.id,
      new Date(startedAt).toISOString(),
      new Date(endedAt!).toISOString(),
    );
    setAddingTime(null);
    await load();
  }

  function setLost(lost: boolean) {
    setPieceLost(piece.id, lost).then(load).catch(showError('Could not save the piece'));
  }

  function setRating(rating: number | null) {
    setPieceRating(piece.id, rating).then(load).catch(showError('Could not save the piece'));
  }

  function setTemplate(isTemplate: boolean) {
    setPieceTemplate(piece.id, isTemplate).then(load).catch(showError('Could not save the piece'));
  }

  function startWorkingAgain() {
    workAgain(piece.id)
      .then(() => router.navigate('/'))
      .catch(showError('Could not start the piece'));
  }

  function setUsedUp(value: boolean) {
    setPrepUsedUp(piece.id, value).then(load).catch(showError('Could not save the prep'));
  }

  if (editing) {
    return (
      <PieceEditForm
        piece={piece}
        segments={segments}
        loadedAt={loadedAt}
        worked={sumDays(days, 'worked')}
        usedByCount={usedBy.length}
        onTimesChanged={load}
        onCancel={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          load().catch(showError('Could not load the piece'));
        }}
        onDeleted={() => router.back()}
      />
    );
  }

  return (
    // The iOS header is see-through, so the content has to be inset below it.
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.page}>
      <Stack.Screen
        options={{
          title: piece.name,
          headerLeft: undefined,
          headerRight: () => (
            <Pressable
              style={({ pressed }) => [styles.editButton, pressed && styles.buttonPressed]}
              onPress={() => setEditing(true)}
            >
              <Text style={styles.editButtonText}>Edit</Text>
            </Pressable>
          ),
        }}
      />
      <Totals
        days={days}
        prepTime={prepTime}
        cost={cost}
        tag={!piece.finished_at ? 'Unfinished' : piece.lost ? 'Lost' : null}
        noCost={piece.no_cost === 1}
      />
      {/* A counted prep's parts: what a piece using one takes in time and cost. */}
      {partCount !== null && (
        <Card>
          <View style={styles.row}>
            <Text style={[styles.text, styles.fill]}>Made</Text>
            <Text style={styles.value}>
              {partCount} {piece.size_unit}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={[styles.text, styles.fill]}>Time per part</Text>
            <Text style={styles.value}>{formatDuration(prepTime.total / partCount)}</Text>
          </View>
          {cost.hasSupplies && (
            <View style={styles.row}>
              <Text style={[styles.text, styles.fill]}>
                {cost.estimated ? 'Cost per part, estimated' : 'Cost per part'}
              </Text>
              <Text style={styles.value}>{formatCost(Math.round(cost.cents / partCount))}</Text>
            </View>
          )}
        </Card>
      )}
      {/* The rows that change the piece: a finished by eye prep's All used and how much of it
          is assigned, a good piece's grade, a finished piece's switches, Work on it again, then
          Add time. */}
      <Card>
        {finishedByEyePrep && (
          <View style={styles.row}>
            <View style={styles.fill}>
              <Text style={styles.text}>All used</Text>
              <Text style={styles.note}>Its full cost goes to what used it.</Text>
            </View>
            <Switch
              value={usedUp}
              onValueChange={setUsedUp}
              trackColor={{ true: colors.primary }}
            />
          </View>
        )}
        {finishedByEyePrep && !piece.lost && (
          <View style={styles.row}>
            <View style={styles.fill}>
              <AssignedBar usedShare={usedShare} usedUp={usedUp} />
            </View>
          </View>
        )}
        {piece.finished_at && piece.category === 'piece' && !piece.lost && (
          <View style={styles.row}>
            <Text style={[styles.text, styles.fill]}>Grade</Text>
            <StarRating rating={piece.rating} onChange={setRating} />
          </View>
        )}
        {piece.finished_at && (
          <View style={styles.row}>
            <View style={styles.fill}>
              <Text style={styles.text}>Use as template</Text>
              {partCount !== null && piece.is_template === 0 && (
                <Text style={styles.note}>Pieces pick counted prep by its template.</Text>
              )}
            </View>
            <Switch
              value={piece.is_template === 1}
              onValueChange={setTemplate}
              trackColor={{ true: colors.primary }}
            />
          </View>
        )}
        {piece.finished_at && (
          <View style={styles.row}>
            <Text style={[styles.text, styles.fill]}>Lost</Text>
            <Switch
              value={piece.lost === 1}
              onValueChange={setLost}
              trackColor={{ true: colors.primary }}
            />
          </View>
        )}
        {piece.finished_at && piece.category === 'piece' && piece.is_template === 0 && (
          <Pressable
            style={({ pressed }) => [styles.row, pressed && styles.buttonPressed]}
            onPress={startWorkingAgain}
          >
            <Text style={[styles.text, styles.fill]}>Work on it again</Text>
            <Chevron />
          </Pressable>
        )}
        <Pressable
          style={({ pressed }) => [styles.row, pressed && styles.buttonPressed]}
          onPress={() => setAddingTime(getLastHour(runningSince))}
        >
          <Text style={[styles.text, styles.fill]}>Add time</Text>
          <Chevron />
        </Pressable>
      </Card>
      {/* What went into it, then on a prep, what it went into. A batch of a counted template
          takes none: pieces use the template, which has them. */}
      {piece.template_counted ? (
        <Card>
          <View style={styles.row}>
            <Text style={styles.secondaryText}>
              Its template has its prep and supplies, and pieces use the template.
            </Text>
          </View>
        </Card>
      ) : (
        <>
          <UsesSection
            kind="prep"
            usedBy={piece.category}
            lines={prepLines}
            uses={prepQueries}
            onChange={load}
          />
          <UsesSection
            kind="supply"
            usedBy={piece.category}
            lines={supplyLines}
            uses={supplyQueries}
            onChange={load}
          />
        </>
      )}
      {piece.category === 'prep' && <UsedBy usedBy={usedBy} usedUp={usedUp} size={piece} />}
      {days.length > 1 && <DayTable days={days} />}
      {piece.notes && (
        <Card>
          <Text style={[styles.text, styles.notes]}>{piece.notes}</Text>
        </Card>
      )}
      {piece.photo_file_name && (
        <Image
          source={{ uri: getPhotoUri(piece.photo_file_name) }}
          style={[styles.photo, { aspectRatio: photoAspectRatio }]}
          onLoad={({ nativeEvent }) =>
            setPhotoAspectRatio(nativeEvent.source.width / nativeEvent.source.height)
          }
        />
      )}
      {addingTime && (
        <EntryTimesPanel
          title={`Add time to ${piece.name}`}
          initialStartedAt={addingTime.startedAt}
          initialEndedAt={addingTime.endedAt}
          onCancel={() => setAddingTime(null)}
          onSave={saveAddedTime}
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    padding: 16,
    gap: 16,
  },
  photo: {
    width: '100%',
    borderRadius: 8,
  },
  // A group of rows, the same as Add Work's cards.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  fill: {
    flex: 1,
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  section: {
    gap: 8,
  },
  heading: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
  },
  totalHeader: {
    gap: 4,
  },
  text: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.text,
  },
  notes: {
    paddingVertical: 12,
  },
  note: {
    fontSize: 16,
    color: colors.secondaryText,
  },
  value: {
    fontSize: 18,
    lineHeight: 20,
    fontVariant: ['tabular-nums'],
    color: colors.text,
  },
  // A box and its arrow, like a piece on the Pieces tab.
  useRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  addRow: {
    paddingVertical: 8,
  },
  addText: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.primary,
  },
  numberColumn: {
    textAlign: 'right',
  },
  estimatedColumn: {
    width: 90,
  },
  actualColumn: {
    width: 70,
  },
  chevronColumn: {
    width: 12,
  },
  editButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  editButtonText: {
    fontSize: 16,
    lineHeight: 18,
    color: colors.textOnFill,
  },
  buttonPressed: {
    opacity: 0.6,
  },
  totalLine: {
    fontSize: 18,
    color: colors.text,
  },
  totalTime: {
    fontSize: 32,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  secondaryText: {
    fontSize: 16,
    color: colors.secondaryText,
  },
  tableValue: {
    fontSize: 16,
    fontVariant: ['tabular-nums'],
    color: colors.text,
  },
  dayTable: {
    flexDirection: 'row',
  },
  // Never narrower than its widest date (flexShrink stays at its default of 0).
  dayColumn: {
    flexGrow: 1,
  },
  tableCell: {
    paddingVertical: 12,
  },
  // The space before a duration column sits inside its cells, so the lines between days run
  // unbroken across the table.
  durationCell: {
    paddingLeft: 12,
    textAlign: 'right',
  },
  tableLine: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
});
