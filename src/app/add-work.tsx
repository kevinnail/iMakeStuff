import DateTimePicker from '@react-native-community/datetimepicker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
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
import { Dropdown } from '@/components/Dropdown';
import { getOverlapMessage, useEntryTimes, yesterdayAt } from '@/components/EntryTimesPanel';
import { FieldError, useMissingFields } from '@/components/FieldError';
import { getNotesPlaceholder, outcomeOptions, type Outcome } from '@/components/FinishPiecePanel';
import { JoinedButtons } from '@/components/JoinedButtons';
import { NewPrepPanel } from '@/components/NewPrepPanel';
import { getTemplateChoices, UseChoices, type MissingUse } from '@/components/UseChoices';
import type { UseChoice } from '@/components/UsePanel';
import { addPastWork } from '@/db/queries/entryQueries';
import { getTemplates, type PieceCategory, type Template } from '@/db/queries/pieceQueries';
import { getAvailablePrep, getTemplateUses, type AvailablePrep } from '@/db/queries/prepQueries';
import { getAvailableSupplies, type AvailableSupply } from '@/db/queries/supplyQueries';
import { colors } from '@/theme';
import { getOverlapMissing, getPieceMissing, missingMessages } from '@/utils/missingFields';
import { showPhotoChoices, withSavedPhoto } from '@/utils/photoStorage';
import { defaultsToTemplate } from '@/utils/prepTime';
import { showError } from '@/utils/showError';

// A category starts an empty new piece or prep; existing fills one in from a template.
type Source = PieceCategory | 'existing';

const sourceOptions: { value: Source; label: string; color?: string }[] = [
  { value: 'piece', label: 'New piece' },
  { value: 'prep', label: 'New prep', color: colors.prep },
  { value: 'existing', label: 'Existing' },
];

const categoryOptions: { value: PieceCategory; label: string; color?: string }[] = [
  { value: 'piece', label: 'Piece' },
  { value: 'prep', label: 'Prep', color: colors.prep },
];

export default function AddWorkScreen() {
  // Pieces opens it on New prep while its Prep list shows. Anything else starts on New piece.
  const { category: openedFor } = useLocalSearchParams<{ category?: PieceCategory }>();
  const startingCategory: PieceCategory = openedFor === 'prep' ? 'prep' : 'piece';
  const [templates, setTemplates] = useState<Template[]>([]);
  const [availablePrep, setAvailablePrep] = useState<AvailablePrep[]>([]);
  const [availableSupplies, setAvailableSupplies] = useState<AvailableSupply[]>([]);
  const [source, setSource] = useState<Source>(startingCategory);
  const [template, setTemplate] = useState<Template | null>(null);
  const [category, setCategory] = useState<PieceCategory>(startingCategory);
  const [name, setName] = useState('');
  const [chosenPrep, setChosenPrep] = useState<UseChoice[]>([]);
  const [missingPrep, setMissingPrep] = useState<MissingUse[]>([]);
  const [chosenSupplies, setChosenSupplies] = useState<UseChoice[]>([]);
  const [missingSupplies, setMissingSupplies] = useState<MissingUse[]>([]);
  const [prepKind, setPrepKind] = useState<PrepKind>('counted');
  const [countTexts, setCountTexts] = useState({ amountText: '', unitText: '' });
  const { startedAt, endedAt, overlaps, changeStart, setEndedAt, reloadOverlaps } = useEntryTimes(
    yesterdayAt(9),
    yesterdayAt(10),
  );
  const [finishing, setFinishing] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>('good');
  // null until the switch is tapped.
  const [templateChoice, setTemplateChoice] = useState<boolean | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  // The photo's own shape once it loads, so it shows whole, the way the piece's page shows it.
  const [photoAspectRatio, setPhotoAspectRatio] = useState(3 / 4);
  // From the camera or library opening until its photo is ready, which can run on after the
  // library closes while an iCloud photo downloads.
  const [gettingPhoto, setGettingPhoto] = useState(false);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const trimmedName = name.trim();
  const trimmedNotes = notes.trim();
  // Existing shows the rest of the form once a template is picked.
  const showForm = source !== 'existing' || template !== null;

  // A batch of a counted prep's template: the template knows its count, prep, and supplies.
  const laterBatch = category === 'prep' && template !== null && template.size_amount !== null;
  const saveAsTemplate =
    templateChoice ??
    defaultsToTemplate(category === 'prep' && prepKind === 'counted', outcome === 'lost');
  // Past work can't overlap anything.
  const overlap = overlaps.at(0);
  const templateOptions = templates.map((option) => ({
    key: option.id,
    label: option.name,
    photoFileName: option.photo_file_name,
    ...(option.category === 'prep' ? { detail: 'prep' } : {}),
    template: option,
  }));
  const missingFields = useMissingFields([
    ...getPieceMissing({
      name,
      finished: finishing,
      hasPhoto: photoUri !== null,
      notes,
      countTexts: category === 'prep' && !laterBatch && prepKind === 'counted' ? countTexts : null,
    }),
    ...getOverlapMissing(overlap !== undefined),
  ]);
  const busy = saving || gettingPhoto;

  useEffect(() => {
    Promise.all([getTemplates(), getAvailablePrep(null), getAvailableSupplies(null)])
      .then(([savedTemplates, prep, supplies]) => {
        setTemplates(savedTemplates);
        setAvailablePrep(prep);
        setAvailableSupplies(supplies);
      })
      .catch(showError('Could not load your templates'));
  }, []);

  function changePhoto() {
    showPhotoChoices({
      canRemove: photoUri !== null,
      onPicked: setPhotoUri,
      onRemove: () => setPhotoUri(null),
      onLoading: setGettingPhoto,
    });
  }

  // Each source starts with no template, no prep or supplies, and counted.
  function chooseSource(value: Source) {
    setSource(value);
    setTemplate(null);
    setChosenPrep([]);
    setMissingPrep([]);
    setChosenSupplies([]);
    setMissingSupplies([]);
    setPrepKind('counted');
    setCountTexts({ amountText: '', unitText: '' });
    setTemplateChoice(null);
    if (value !== 'existing') setCategory(value);
  }

  // Fills in the new piece from the template. Nothing on the template changes. A batch of a
  // counted prep saves no prep or supplies, so it takes none.
  function chooseTemplate(chosen: Template) {
    getTemplateUses(chosen.id, null, { prep: availablePrep, supplies: availableSupplies })
      .then((uses) => {
        const counted = chosen.size_amount !== null;
        const prep = getTemplateChoices(counted ? [] : uses.prep);
        const supplies = getTemplateChoices(counted ? [] : uses.supplies);
        setTemplate(chosen);
        setName(chosen.name);
        setCategory(chosen.category);
        setChosenPrep(prep.chosen);
        setMissingPrep(prep.missing);
        setChosenSupplies(supplies.chosen);
        setMissingSupplies(supplies.missing);
        setPrepKind(getPrepKind(chosen));
        setCountTexts(getCountTexts(chosen));
      })
      .catch(showError('Could not load the template'));
  }

  function save() {
    if (!missingFields.check()) return;
    const size = category === 'prep' ? readPrepCount(prepKind, countTexts) : noCount;
    setSaving(true);
    withSavedPhoto(photoUri, (photoFileName) =>
      addPastWork({
        piece: { name: trimmedName, category, templateId: template?.id ?? null, ...size },
        startedAt: new Date(startedAt).toISOString(),
        endedAt: new Date(endedAt).toISOString(),
        photoFileName,
        finish: finishing
          ? {
              notes: trimmedNotes || null,
              lost: outcome === 'lost',
              isTemplate: template === null && saveAsTemplate,
            }
          : null,
        prepUses: laterBatch
          ? []
          : chosenPrep.map(({ item, share }) => ({ prepId: item.id, share })),
        supplyUses: laterBatch
          ? []
          : chosenSupplies.map(({ item, share }) => ({ supplyId: item.id, share })),
      }),
    )
      .then(() => router.back())
      .catch((error: Error) => {
        setSaving(false);
        Alert.alert('Could not save', error.message);
      });
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={styles.page}
    >
      <JoinedButtons options={sourceOptions} selected={source} onSelect={chooseSource} />
      {source === 'existing' &&
        (templates.length === 0 ? (
          <Text style={styles.secondaryText}>
            No templates yet. Turn on Use as template on a finished piece&apos;s page.
          </Text>
        ) : (
          <Dropdown
            options={templateOptions}
            selectedKey={template?.id ?? null}
            placeholder="Choose a template"
            onSelect={(option) => chooseTemplate(option.template)}
          />
        ))}
      {showForm && (
        <>
          <View style={styles.card}>
            <TextInput
              style={styles.nameInput}
              value={name}
              onChangeText={setName}
              placeholder="What did you make?"
              placeholderTextColor={colors.secondaryText}
              autoFocus={source !== 'existing'}
            />
            {missingFields.shown.includes('name') && (
              <FieldError message={missingMessages.name} style={styles.cardError} />
            )}
            {source === 'existing' && (
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
            )}
            {category === 'prep' && !laterBatch && (
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
            <View style={styles.cardRow}>
              <Text style={[styles.text, styles.fill]}>Start</Text>
              <DateTimePicker
                value={new Date(startedAt)}
                mode="datetime"
                display="compact"
                accentColor={colors.primary}
                maximumDate={new Date()}
                onValueChange={(_event, date) => changeStart(date.getTime())}
              />
            </View>
            <View style={[styles.cardRow, styles.separator]}>
              <Text style={[styles.text, styles.fill]}>End</Text>
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
            {overlap && (
              <FieldError message={getOverlapMessage(overlap)} style={styles.cardError} />
            )}
          </View>
          {!laterBatch && (
            <UseChoices
              kind="prep"
              usedBy={category}
              availableItems={availablePrep}
              chosen={chosenPrep}
              missing={missingPrep}
              onChange={setChosenPrep}
              onItemAdded={reloadOverlaps}
              // Ends where this work starts, which isn't saved yet for its check to see.
              renderNewPrep={(handlers) => <NewPrepPanel endsAt={startedAt} {...handlers} />}
            />
          )}
          {!laterBatch && (
            <UseChoices
              kind="supply"
              usedBy={category}
              availableItems={availableSupplies}
              chosen={chosenSupplies}
              missing={missingSupplies}
              onChange={setChosenSupplies}
            />
          )}
          <View style={styles.card}>
            <Pressable
              style={({ pressed }) => [styles.cardRow, pressed && styles.buttonPressed]}
              onPress={changePhoto}
              disabled={gettingPhoto}
            >
              <Text style={[styles.text, styles.fill]}>Photo</Text>
              <Text style={styles.text}>
                {gettingPhoto ? 'Loading…' : photoUri ? 'Change' : 'Add'}
              </Text>
              <Chevron />
            </Pressable>
            {photoUri && (
              <Image
                source={{ uri: photoUri }}
                style={[styles.photo, { aspectRatio: photoAspectRatio }]}
                onLoad={({ nativeEvent }) =>
                  setPhotoAspectRatio(nativeEvent.source.width / nativeEvent.source.height)
                }
              />
            )}
          </View>
          <View style={styles.card}>
            <View style={styles.cardRow}>
              <Text style={[styles.text, styles.fill]}>Finished</Text>
              <Switch
                value={finishing}
                onValueChange={setFinishing}
                trackColor={{ true: colors.primary }}
              />
            </View>
            {finishing && (
              <>
                <View style={[styles.cardRow, styles.separator]}>
                  <View style={styles.fill}>
                    <JoinedButtons
                      options={outcomeOptions}
                      selected={outcome}
                      onSelect={setOutcome}
                      style={styles.trackOnCard}
                    />
                  </View>
                </View>
                <TextInput
                  style={styles.notesInput}
                  value={notes}
                  onChangeText={setNotes}
                  placeholder={getNotesPlaceholder(outcome === 'lost', photoUri !== null)}
                  placeholderTextColor={colors.secondaryText}
                  multiline
                />
                {missingFields.shown.includes('identity') && (
                  <FieldError message={missingMessages.identity} style={styles.cardError} />
                )}
                {template === null && (
                  <View style={[styles.cardRow, styles.separator]}>
                    <Text style={[styles.text, styles.fill]}>Save as template</Text>
                    <Switch
                      value={saveAsTemplate}
                      onValueChange={setTemplateChoice}
                      trackColor={{ true: colors.primary }}
                    />
                  </View>
                )}
              </>
            )}
          </View>
          <View style={styles.buttonRow}>
            <Pressable
              style={[styles.saveButton, busy && styles.buttonDisabled]}
              onPress={save}
              disabled={busy}
            >
              <Text style={styles.saveButtonText}>Save</Text>
            </Pressable>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    padding: 16,
    gap: 16,
  },
  // A group of rows, like the cards on a piece's page.
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
  // The joined buttons' usual track is the card's color, so on a card it takes the page's.
  trackOnCard: {
    backgroundColor: colors.background,
  },
  text: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.text,
  },
  secondaryText: {
    fontSize: 18,
    color: colors.secondaryText,
  },
  // Under the last field on a card, clear of the card's edge.
  cardError: {
    paddingBottom: 12,
  },
  // A box in the page's color on the card, bordered like the Work tab's name box.
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
  // Boxed like the name, under the outcome buttons' row.
  notesInput: {
    marginBottom: 12,
    padding: 12,
    height: 100,
    fontSize: 18,
    textAlignVertical: 'top',
    color: colors.text,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.separator,
    borderRadius: 8,
  },
  photo: {
    width: '100%',
    marginBottom: 16,
    borderRadius: 8,
  },
  buttonPressed: {
    opacity: 0.6,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
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
