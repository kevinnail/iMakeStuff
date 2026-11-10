import { Stack } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Chevron } from '@/components/Chevron';
import {
  getCountTexts,
  getPrepKind,
  noCount,
  PrepKindField,
  readPrepCount,
  type PrepKind,
} from '@/components/CountField';
import { EntryTimesPanel } from '@/components/EntryTimesPanel';
import { FieldError, useMissingFields } from '@/components/FieldError';
import { getNotesPlaceholder } from '@/components/FinishPiecePanel';
import { JoinedButtons } from '@/components/JoinedButtons';
import {
  deletePiece,
  updatePiece,
  type PieceCategory,
  type PieceRecord,
  type PieceSegment,
} from '@/db/queries/pieceQueries';
import { useWorkStore } from '@/store/workStore';
import { colors } from '@/theme';
import { formatDuration, formatTimeRange } from '@/utils/formatTime';
import { getPieceMissing, missingMessages } from '@/utils/missingFields';
import { deletePhoto, getPhotoUri, showPhotoChoices, withSavedPhoto } from '@/utils/photoStorage';
import type { SizeInput } from '@/utils/prepTime';
import { showError } from '@/utils/showError';

// The saved photo, a new one to copy in, or none.
type PhotoChoice = { kind: 'saved' } | { kind: 'new'; uri: string } | { kind: 'none' };

interface PieceEditFormProps {
  piece: PieceRecord;
  segments: PieceSegment[];
  // A running segment counts up to when the piece loaded.
  loadedAt: number;
  worked: number;
  // For prep, how many pieces used it, for the delete confirmation.
  usedByCount: number;
  // Reloads the piece after a segment's times are saved.
  onTimesChanged: () => Promise<void>;
  onCancel: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}

const categoryOptions: { value: PieceCategory; label: string; color?: string }[] = [
  { value: 'piece', label: 'Piece' },
  { value: 'prep', label: 'Prep', color: colors.prep },
];

export function getDeleteMessage(worked: number, usedByCount: number) {
  const workLine = `Its ${formatDuration(worked)} of work comes off the days it was worked.`;
  if (usedByCount === 0) return workLine;
  const pieces = usedByCount === 1 ? 'the piece' : `the ${usedByCount} pieces`;
  return `${workLine} It comes off ${pieces} that used it.`;
}

// The piece's page as a form, the way iOS Contacts edits a contact: Cancel and Save in the
// header, then cards like Add Work's: the name with Piece or Prep, the photo, the notes, the
// times it was worked, and Delete piece at the bottom.
export function PieceEditForm({
  piece,
  segments,
  loadedAt,
  worked,
  usedByCount,
  onTimesChanged,
  onCancel,
  onSaved,
  onDeleted,
}: PieceEditFormProps) {
  const [name, setName] = useState(piece.name);
  const [category, setCategory] = useState(piece.category);
  const [notes, setNotes] = useState(piece.notes ?? '');
  const [photo, setPhoto] = useState<PhotoChoice>(
    piece.photo_file_name ? { kind: 'saved' } : { kind: 'none' },
  );
  // A piece turned into prep starts counted, like new prep.
  const [prepKind, setPrepKind] = useState<PrepKind>(() =>
    piece.category === 'piece' ? 'counted' : getPrepKind(piece),
  );
  const [countTexts, setCountTexts] = useState(() => getCountTexts(piece));
  const [saving, setSaving] = useState(false);
  const [editingSegment, setEditingSegment] = useState<PieceSegment | null>(null);
  const { changeTimes } = useWorkStore();
  const trimmedName = name.trim();
  const trimmedNotes = notes.trim();
  const shownPhotoUri =
    photo.kind === 'new'
      ? photo.uri
      : photo.kind === 'saved' && piece.photo_file_name
        ? getPhotoUri(piece.photo_file_name)
        : null;
  const missingFields = useMissingFields(
    getPieceMissing({
      name,
      finished: piece.finished_at !== null,
      hasPhoto: shownPhotoUri !== null,
      notes,
      countTexts: category === 'prep' && prepKind === 'counted' ? countTexts : null,
    }),
  );

  function changePhoto() {
    showPhotoChoices({
      canRemove: shownPhotoUri !== null,
      onPicked: (uri) => setPhoto({ kind: 'new', uri }),
      onRemove: () => setPhoto({ kind: 'none' }),
    });
  }

  // A piece has no count, so switching to Piece drops it.
  async function save(size: SizeInput) {
    const details = { name: trimmedName, category, notes: trimmedNotes || null, ...size };
    if (photo.kind === 'new') {
      await withSavedPhoto(photo.uri, (photoFileName) =>
        updatePiece(piece.id, { ...details, photoFileName }),
      );
    } else {
      const photoFileName = photo.kind === 'saved' ? piece.photo_file_name : null;
      await updatePiece(piece.id, { ...details, photoFileName });
    }
    if (piece.photo_file_name && photo.kind !== 'saved') deletePhoto(piece.photo_file_name);
  }

  function handleSave() {
    if (!missingFields.check()) return;
    const size = category === 'prep' ? readPrepCount(prepKind, countTexts) : noCount;
    setSaving(true);
    save(size)
      .then(onSaved)
      .catch((error: Error) => {
        setSaving(false);
        Alert.alert('Could not save', error.message);
      });
  }

  // Saved right away, the same as on the Days timeline, so the form's Cancel doesn't undo it.
  // The reload has its own error, so a failed reload doesn't read as a failed save.
  async function saveTimes(segmentId: number, startedAt: number, endedAt: number | null) {
    await changeTimes(
      'segment',
      segmentId,
      new Date(startedAt).toISOString(),
      endedAt === null ? null : new Date(endedAt).toISOString(),
    );
    setEditingSegment(null);
    onTimesChanged().catch(showError('Could not load the piece'));
  }

  function confirmDelete() {
    Alert.alert(`Delete ${piece.name}?`, getDeleteMessage(worked, usedByCount), [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          deletePiece(piece.id)
            .then((photoFileName) => {
              if (photoFileName) deletePhoto(photoFileName);
              onDeleted();
            })
            .catch(showError('Could not delete the piece')),
      },
    ]);
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={styles.page}
    >
      <Stack.Screen
        options={{
          headerLeft: () => (
            <Pressable style={styles.cancelButton} onPress={onCancel}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
          ),
          headerRight: () => (
            <Pressable
              style={[styles.saveButton, saving && styles.buttonDisabled]}
              onPress={handleSave}
              disabled={saving}
            >
              <Text style={styles.saveButtonText}>Save</Text>
            </Pressable>
          ),
        }}
      />
      <View style={styles.card}>
        <TextInput
          style={styles.nameInput}
          value={name}
          onChangeText={setName}
          placeholder="Name"
          placeholderTextColor={colors.secondaryText}
        />
        {missingFields.shown.includes('name') && (
          <FieldError message={missingMessages.name} style={styles.cardError} />
        )}
        <View style={[styles.cardRow, styles.separator]}>
          <View style={styles.fill}>
            <JoinedButtons
              options={categoryOptions}
              selected={category}
              onSelect={setCategory}
              style={styles.trackOnCard}
            />
          </View>
        </View>
        {category === 'prep' && (
          <View style={[styles.cardRow, styles.separator]}>
            <View style={styles.fill}>
              <PrepKindField
                kind={prepKind}
                onChangeKind={setPrepKind}
                texts={countTexts}
                onChangeTexts={setCountTexts}
                missing={missingFields.shown}
              />
            </View>
          </View>
        )}
      </View>
      <View style={styles.card}>
        <Pressable
          style={({ pressed }) => [styles.cardRow, pressed && styles.buttonPressed]}
          onPress={changePhoto}
        >
          <Text style={[styles.text, styles.fill]}>Photo</Text>
          <Text style={styles.text}>{shownPhotoUri ? 'Change' : 'Add'}</Text>
          <Chevron />
        </Pressable>
        {shownPhotoUri && <Image source={{ uri: shownPhotoUri }} style={styles.photo} />}
      </View>
      <View style={styles.card}>
        <TextInput
          style={styles.notesInput}
          value={notes}
          onChangeText={setNotes}
          placeholder={
            piece.finished_at
              ? getNotesPlaceholder(piece.lost === 1, shownPhotoUri !== null)
              : 'Notes'
          }
          placeholderTextColor={colors.secondaryText}
          multiline
        />
        {missingFields.shown.includes('identity') && (
          <FieldError message={missingMessages.identity} style={styles.cardError} />
        )}
      </View>
      <View style={styles.section}>
        <Text style={styles.heading}>Time</Text>
        <View style={styles.card}>
          {segments.map((segment, index) => {
            const start = Date.parse(segment.started_at);
            const end = segment.ended_at === null ? null : Date.parse(segment.ended_at);
            return (
              <Pressable
                key={segment.id}
                style={({ pressed }) => [
                  styles.cardRow,
                  index > 0 && styles.separator,
                  pressed && styles.buttonPressed,
                ]}
                onPress={() => setEditingSegment(segment)}
              >
                <Text style={[styles.text, styles.fill]}>{formatTimeRange(start, end)}</Text>
                <Text style={styles.secondaryText}>
                  {formatDuration((end ?? loadedAt) - start)}
                </Text>
                <Chevron />
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={styles.card}>
        <Pressable
          style={({ pressed }) => [styles.cardRow, pressed && styles.buttonPressed]}
          onPress={confirmDelete}
        >
          <Text style={styles.deleteButtonText}>Delete piece</Text>
        </Pressable>
      </View>
      {editingSegment && (
        <EntryTimesPanel
          title={piece.name}
          initialStartedAt={Date.parse(editingSegment.started_at)}
          initialEndedAt={
            editingSegment.ended_at === null ? null : Date.parse(editingSegment.ended_at)
          }
          overlapAllowed={(other) => other.kind === 'segment' && other.id === editingSegment.id}
          onCancel={() => setEditingSegment(null)}
          onSave={(startedAt, endedAt) => saveTimes(editingSegment.id, startedAt, endedAt)}
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
  // A group of rows, the same as Add Work's cards.
  card: {
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  separator: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  fill: {
    flex: 1,
  },
  // Under the last field on a card, clear of the card's edge.
  cardError: {
    paddingBottom: 12,
  },
  // The joined buttons' usual track is the card's color, so on a card it takes the page's.
  trackOnCard: {
    backgroundColor: colors.background,
  },
  // A heading over its card, the same as the piece page's Prep and Supplies.
  section: {
    gap: 8,
  },
  heading: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
  },
  text: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.text,
  },
  secondaryText: {
    fontSize: 16,
    color: colors.secondaryText,
  },
  photo: {
    width: '100%',
    aspectRatio: 4 / 3,
    marginBottom: 16,
    borderRadius: 8,
  },
  buttonPressed: {
    opacity: 0.6,
  },
  // Boxes in the page's color on the card, the same as Add Work's.
  nameInput: {
    marginVertical: 12,
    padding: 12,
    fontSize: 18,
    color: colors.text,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.separator,
    borderRadius: 8,
  },
  notesInput: {
    marginVertical: 12,
    padding: 12,
    height: 120,
    fontSize: 18,
    textAlignVertical: 'top',
    color: colors.text,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.separator,
    borderRadius: 8,
  },
  deleteButtonText: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.danger,
  },
  cancelButton: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  cancelButtonText: {
    fontSize: 16,
    lineHeight: 18,
    color: colors.text,
  },
  saveButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  saveButtonText: {
    fontSize: 16,
    lineHeight: 18,
    color: colors.textOnFill,
  },
});
