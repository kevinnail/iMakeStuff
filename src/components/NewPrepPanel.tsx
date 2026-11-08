import DateTimePicker from '@react-native-community/datetimepicker';
import { useEffect, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Chevron } from '@/components/Chevron';
import { PrepKindField, readPrepCount, type PrepKind } from '@/components/CountField';
import { getOverlapMessage, useEntryTimes, yesterdayAt } from '@/components/EntryTimesPanel';
import { FieldError, useMissingFields } from '@/components/FieldError';
import { UseChoices } from '@/components/UseChoices';
import type { UseChoice } from '@/components/UsePanel';
import { addPastWork } from '@/db/queries/entryQueries';
import { getAvailablePrep, type AvailablePrep } from '@/db/queries/prepQueries';
import { getAvailableSupplies, type AvailableSupply } from '@/db/queries/supplyQueries';
import { colors } from '@/theme';
import { getOverlapMissing, getPieceMissing, missingMessages } from '@/utils/missingFields';
import { showPhotoChoices, withSavedPhoto } from '@/utils/photoStorage';
import { showError } from '@/utils/showError';

interface NewPrepPanelProps {
  // Where the work it goes into starts, on a form not saved yet, so the prep's hour ends there
  // instead of overlapping it. Without one, it's yesterday 9 to 10.
  endsAt?: number;
  onCancel: () => void;
  // The prep as Add prep lists it, so it can be picked straight away.
  onSaved: (prep: AvailablePrep) => void;
}

// Slides up over Add prep to record prep made earlier, the way Add supply does for a supply, so
// a form in progress isn't left. It's Add Work's New prep, saved finished since it's being used,
// with the supplies it was made from, which give it its cost. Pieces pick counted prep through
// its template, so counted prep is saved as one.
export function NewPrepPanel({ endsAt = yesterdayAt(10), onCancel, onSaved }: NewPrepPanelProps) {
  const [name, setName] = useState('');
  const [prepKind, setPrepKind] = useState<PrepKind>('counted');
  const [countTexts, setCountTexts] = useState({ amountText: '', unitText: '' });
  const [availableSupplies, setAvailableSupplies] = useState<AvailableSupply[]>([]);
  const [chosenSupplies, setChosenSupplies] = useState<UseChoice[]>([]);
  const { startedAt, endedAt, overlaps, changeStart, setEndedAt } = useEntryTimes(
    endsAt - 60 * 60 * 1000,
    endsAt,
  );
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  // From the camera or library opening until its photo is ready.
  const [gettingPhoto, setGettingPhoto] = useState(false);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  // Past work can't overlap anything.
  const overlap = overlaps.at(0);
  const missingFields = useMissingFields([
    ...getPieceMissing({
      name,
      finished: true,
      hasPhoto: photoUri !== null,
      notes,
      countTexts: prepKind === 'counted' ? countTexts : null,
    }),
    ...getOverlapMissing(overlap !== undefined),
  ]);
  const busy = saving || gettingPhoto;

  useEffect(() => {
    getAvailableSupplies(null)
      .then(setAvailableSupplies)
      .catch(showError('Could not load your supplies'));
  }, []);

  function changePhoto() {
    showPhotoChoices({
      canRemove: photoUri !== null,
      onPicked: setPhotoUri,
      onRemove: () => setPhotoUri(null),
      onLoading: setGettingPhoto,
    });
  }

  function save() {
    if (!missingFields.check()) return;
    setSaving(true);
    withSavedPhoto(photoUri, (photoFileName) =>
      addPastWork({
        piece: {
          name: name.trim(),
          category: 'prep',
          templateId: null,
          ...readPrepCount(prepKind, countTexts),
        },
        startedAt: new Date(startedAt).toISOString(),
        endedAt: new Date(endedAt).toISOString(),
        photoFileName,
        finish: { notes: notes.trim() || null, lost: false, isTemplate: prepKind === 'counted' },
        prepUses: [],
        supplyUses: chosenSupplies.map(({ item, share }) => ({ supplyId: item.id, share })),
      }),
    )
      .then(async (prepId) => {
        const available = await getAvailablePrep(null);
        onSaved(available.find(({ id }) => id === prepId)!);
      })
      .catch((error: Error) => {
        setSaving(false);
        Alert.alert('Could not save', error.message);
      });
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
      <KeyboardAvoidingView style={styles.overlay} behavior="padding">
        <View style={styles.panel}>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <Text style={styles.title}>New prep</Text>
            <TextInput
              style={[styles.input, missingFields.shown.includes('name') && styles.missingInput]}
              value={name}
              onChangeText={setName}
              placeholder="What did you make?"
              placeholderTextColor={colors.secondaryText}
              autoFocus
            />
            {missingFields.shown.includes('name') && <FieldError message={missingMessages.name} />}
            <PrepKindField
              kind={prepKind}
              onChangeKind={setPrepKind}
              texts={countTexts}
              onChangeTexts={setCountTexts}
              missing={missingFields.shown}
            />
            <View style={styles.row}>
              <Text style={[styles.label, styles.fill]}>Start</Text>
              <DateTimePicker
                value={new Date(startedAt)}
                mode="datetime"
                display="compact"
                accentColor={colors.primary}
                maximumDate={new Date()}
                onValueChange={(_event, date) => changeStart(date.getTime())}
              />
            </View>
            <View style={styles.row}>
              <Text style={[styles.label, styles.fill]}>End</Text>
              <DateTimePicker
                value={new Date(endedAt)}
                mode="datetime"
                display="compact"
                accentColor={colors.primary}
                minimumDate={new Date(startedAt)}
                maximumDate={new Date()}
                onValueChange={(_event, date) => setEndedAt(date.getTime())}
              />
            </View>
            {overlap && <FieldError message={getOverlapMessage(overlap)} />}
            <UseChoices
              kind="supply"
              usedBy="prep"
              availableItems={availableSupplies}
              chosen={chosenSupplies}
              missing={[]}
              onChange={setChosenSupplies}
              style={styles.useCard}
            />
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.buttonPressed]}
              onPress={changePhoto}
              disabled={gettingPhoto}
            >
              <Text style={[styles.label, styles.fill]}>Photo</Text>
              <Text style={styles.label}>
                {gettingPhoto ? 'Loading…' : photoUri ? 'Change' : 'Add'}
              </Text>
              <Chevron />
            </Pressable>
            {photoUri && <Image source={{ uri: photoUri }} style={styles.photo} />}
            <TextInput
              style={[
                styles.input,
                styles.notesInput,
                missingFields.shown.includes('identity') && styles.missingInput,
              ]}
              value={notes}
              onChangeText={setNotes}
              placeholder={photoUri ? 'Notes' : 'No photo: describe it.'}
              placeholderTextColor={colors.secondaryText}
              multiline
            />
            {missingFields.shown.includes('identity') && (
              <FieldError message={missingMessages.identity} />
            )}
          </ScrollView>
          <SafeAreaView edges={{ bottom: 'additive' }} style={styles.footer}>
            <View style={styles.buttonRow}>
              <Pressable style={styles.cancelButton} onPress={onCancel}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.saveButton, busy && styles.buttonDisabled]}
                onPress={save}
                disabled={busy}
              >
                <Text style={styles.saveButtonText}>Save</Text>
              </Pressable>
            </View>
          </SafeAreaView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  panel: {
    maxHeight: '90%',
    overflow: 'hidden',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    backgroundColor: colors.surface,
  },
  // Shrinks to the room left above Cancel and Save, so nothing scrolls behind them.
  scroll: {
    flexShrink: 1,
  },
  content: {
    padding: 16,
    gap: 12,
  },
  title: {
    fontSize: 20,
    color: colors.text,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  fill: {
    flex: 1,
  },
  label: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.text,
  },
  input: {
    fontSize: 18,
    padding: 12,
    color: colors.text,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.separator,
    borderRadius: 8,
  },
  notesInput: {
    height: 100,
    textAlignVertical: 'top',
  },
  missingInput: {
    borderColor: colors.danger,
  },
  // The supply list's card, on the page's color since this panel is the cards' color.
  useCard: {
    backgroundColor: colors.background,
  },
  photo: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 8,
  },
  buttonPressed: {
    opacity: 0.6,
  },
  footer: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
    backgroundColor: colors.background,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  cancelButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  cancelButtonText: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.text,
  },
  saveButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  saveButtonText: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.textOnFill,
  },
});
