import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { Card } from '@/components/Card';
import { Chevron } from '@/components/Chevron';
import { EntryTimesPanel } from '@/components/EntryTimesPanel';
import { NewPrepPanel } from '@/components/NewPrepPanel';
import { PieceEditForm } from '@/components/PieceEditForm';
import { AssignedBar } from '@/components/AssignedBar';
import { Tag } from '@/components/Tag';
import {
  getSavedChoice,
  UsePanel,
  useLabels,
  type AvailableItem,
  type UseKind,
} from '@/components/UsePanel';
import { addPieceTime } from '@/db/queries/entryQueries';
import {
  getPieceDetail,
  setPieceLost,
  setPieceTemplate,
  type PieceCategory,
  type PieceRecord,
} from '@/db/queries/pieceQueries';
import {
  addPrepUse,
  changePrepUse,
  getAvailablePrep,
  removePrepUse,
  setPrepUsedUp,
  type PieceUsingPrep,
  type UsedPrep,
} from '@/db/queries/prepQueries';
import {
  addSupplyUse,
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
  type BatchSize,
  type Share,
  type UseShare,
} from '@/utils/prepTime';
import { getWorkDays, type WorkDay } from '@/utils/workDays';
import { getPhotoUri } from '@/utils/photoStorage';
import { colors } from '@/theme';
import { showError } from '@/utils/showError';

interface PiecePage {
  piece: PieceRecord;
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
  use: UseShare & { id: number };
  item: { id: number; name: string } & BatchSize;
  values: string[];
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

const dayColumns: { label: string; field: DayField; width: number }[] = [
  { label: 'Worked', field: 'worked', width: 76 },
  { label: 'Break', field: 'onBreak', width: 60 },
  { label: 'Other pieces', field: 'otherPieces', width: 124 },
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

// One line per day, so a piece worked over many days still fits on one screen.
function DayTable({ days }: { days: WorkDay[] }) {
  return (
    <Card>
      <View style={styles.row}>
        <Text style={[styles.secondaryText, styles.fill]}>Day</Text>
        {dayColumns.map(({ label, width }) => (
          <Text key={label} style={[styles.secondaryText, styles.numberColumn, { width }]}>
            {label}
          </Text>
        ))}
      </View>
      {days.map((day) => (
        <View key={day.dayStart} style={styles.row}>
          <Text style={[styles.tableValue, styles.fill]}>{formatDay(day.dayStart)}</Text>
          {dayColumns.map(({ field, width }) => (
            <Text key={field} style={[styles.tableValue, styles.numberColumn, { width }]}>
              {formatDuration(day[field])}
            </Text>
          ))}
        </View>
      ))}
    </Card>
  );
}

// The heading, then the prep or supplies as one card: a row per use with its share and what it
// adds to the piece (prep time and cost, or a supply's cost), tapped to change or remove it, and
// Add prep or Add supply as the last row, the same as on Add Work.
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
      <Card>
        {lines.length === 0 && (
          <View style={styles.row}>
            <Text style={styles.secondaryText}>{labels.noneAdded}</Text>
          </View>
        )}
        {lines.map((line) => (
          <Pressable
            key={line.use.id}
            style={({ pressed }) => [styles.row, pressed && styles.buttonPressed]}
            onPress={() => setChangingLine(line)}
          >
            {/* A measured batch's share is exact, so it needs no mark. One with no size is a
                guess until it's all used, then shows what it really took. */}
            <View style={styles.fill}>
              <Text style={styles.text}>{line.item.name}</Text>
              {!line.use.measured && (
                <Text style={styles.note}>{line.use.used_up ? 'Actual' : 'Estimated'}</Text>
              )}
            </View>
            <Text style={styles.value}>
              {line.use.used_up && !line.use.measured
                ? formatPercent(getActualShare(line.use))
                : formatAmount(line.use, line.item)}
            </Text>
            <View style={styles.valuesColumn}>
              {line.values.map((value) => (
                <Text key={value} style={[styles.value, styles.numberColumn]}>
                  {value}
                </Text>
              ))}
            </View>
            <Chevron />
          </Pressable>
        ))}
        <Pressable
          style={({ pressed }) => [styles.row, pressed && styles.buttonPressed]}
          onPress={openItemList}
        >
          <Text style={styles.addText}>{labels.add}</Text>
        </Pressable>
      </Card>
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
  // undefined while loading, null when no piece has this id.
  const [page, setPage] = useState<PiecePage | null>();
  const [photoAspectRatio, setPhotoAspectRatio] = useState(3 / 4);
  const [editing, setEditing] = useState(false);
  const [addingTime, setAddingTime] = useState<{ startedAt: number; endedAt: number } | null>(null);

  const load = useCallback(
    () =>
      getPieceDetail(pieceId).then((detail) =>
        setPage(
          detail && {
            piece: detail.piece,
            days: getWorkDays(detail.segments, detail.otherSegments, detail.breaks, Date.now()),
            runningSince:
              [...detail.segments, ...detail.otherSegments, ...detail.breaks].find(
                (entry) => entry.ended_at === null,
              )?.started_at ?? null,
            usedPrep: detail.usedPrep,
            usedBy: detail.usedBy,
            usedSupplies: detail.usedSupplies,
          },
        ),
      ),
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

  const { piece, days, runningSince, usedPrep, usedBy, usedSupplies } = page;
  const prepTime = getPrepTime(sumDays(days, 'worked'), usedPrep);
  const cost = getCost(piece.id, usedPrep, usedSupplies);
  const finishedPrep = piece.category === 'prep' && piece.finished_at !== null;
  // Only prep has a count.
  const partCount = piece.size_amount;
  const finishedByEyePrep = finishedPrep && partCount === null;
  const usedShare = usedBy.reduce((total, use) => total + getShareValue(use), 0);
  // Every use carries whether its uses have closed the prep, so the page follows the same rule.
  const usedUp = piece.used_up_at !== null || usedBy.some((use) => use.used_up === 1);

  const prepLines = prepTime.lines.map((line, index): UseLine => {
    const costLine = cost.prepLines[index];
    return {
      use: line,
      item: {
        id: line.prep_id,
        name: line.prep_name,
        size_amount: line.size_amount,
        size_unit: line.size_unit,
      },
      values: [
        formatDuration(line.milliseconds),
        ...(costLine.hasSupplies ? [formatCost(costLine.cents)] : []),
      ],
    };
  });
  const supplyLines = cost.supplyLines.map((line): UseLine => ({
    use: line,
    item: {
      id: line.supply_id,
      name: line.supply_name,
      size_amount: line.size_amount,
      size_unit: line.size_unit,
    },
    values: [formatCost(line.cents)],
  }));
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

  function setTemplate(isTemplate: boolean) {
    setPieceTemplate(piece.id, isTemplate).then(load).catch(showError('Could not save the piece'));
  }

  function setUsedUp(value: boolean) {
    setPrepUsedUp(piece.id, value).then(load).catch(showError('Could not save the prep'));
  }

  if (editing) {
    return (
      <PieceEditForm
        piece={piece}
        worked={sumDays(days, 'worked')}
        usedByCount={usedBy.length}
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
          is assigned, a finished piece's switches, then Add time. */}
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
        <Pressable
          style={({ pressed }) => [styles.row, pressed && styles.buttonPressed]}
          onPress={() => setAddingTime(getLastHour(runningSince))}
        >
          <Text style={[styles.text, styles.fill]}>Add time</Text>
          <Chevron />
        </Pressable>
      </Card>
      {piece.category === 'piece' ? (
        <UsesSection
          kind="prep"
          usedBy="piece"
          lines={prepLines}
          uses={prepQueries}
          onChange={load}
        />
      ) : (
        <UsedBy usedBy={usedBy} usedUp={usedUp} size={piece} />
      )}
      <UsesSection
        kind="supply"
        usedBy={piece.category}
        lines={supplyLines}
        uses={supplyQueries}
        onChange={load}
      />
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
  addText: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.primary,
  },
  numberColumn: {
    textAlign: 'right',
  },
  // Prep time over its cost, or a supply's cost: wide enough for "12h 55m" or "$120.00".
  valuesColumn: {
    width: 80,
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
});
