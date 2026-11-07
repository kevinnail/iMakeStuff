import DateTimePicker from '@react-native-community/datetimepicker';
import { router } from 'expo-router';
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
import { Dropdown } from '@/components/Dropdown';
import { getNotesPlaceholder, outcomeOptions, type Outcome } from '@/components/FinishPiecePanel';
import { JoinedButtons } from '@/components/JoinedButtons';
import {
  confirmTemplateUseUp,
  getTemplateChoices,
  UseChoices,
  type MissingPrep,
} from '@/components/UseChoices';
import type { UseChoice } from '@/components/UsePanel';
import { addPastWork } from '@/db/queries/entryQueries';
import { getTemplates, type PieceCategory, type Template } from '@/db/queries/pieceQueries';
import { getAvailablePrep, getTemplatePrep, type AvailablePrep } from '@/db/queries/prepQueries';
import { getAvailableSupplies, type AvailableSupply } from '@/db/queries/supplyQueries';
import { colors } from '@/theme';
import { showPhotoChoices, withSavedPhoto } from '@/utils/photoStorage';
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

// Yesterday at the given hour, the most likely day to be catching up on.
function yesterdayAt(hours: number) {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  date.setHours(hours, 0, 0, 0);
  return date.getTime();
}

export default function AddWorkScreen() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [availablePrep, setAvailablePrep] = useState<AvailablePrep[]>([]);
  const [availableSupplies, setAvailableSupplies] = useState<AvailableSupply[]>([]);
  const [source, setSource] = useState<Source>('piece');
  const [template, setTemplate] = useState<Template | null>(null);
  const [category, setCategory] = useState<PieceCategory>('piece');
  const [name, setName] = useState('');
  const [chosenPrep, setChosenPrep] = useState<UseChoice[]>([]);
  const [missingPrep, setMissingPrep] = useState<MissingPrep[]>([]);
  const [chosenSupplies, setChosenSupplies] = useState<UseChoice[]>([]);
  const [startedAt, setStartedAt] = useState(() => yesterdayAt(9));
  const [endedAt, setEndedAt] = useState(() => yesterdayAt(10));
  const [finishing, setFinishing] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>('good');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  // From the camera or library opening until its photo is ready, which can run on after the
  // library closes while an iCloud photo downloads.
  const [gettingPhoto, setGettingPhoto] = useState(false);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const trimmedName = name.trim();
  const trimmedNotes = notes.trim();
  // Existing shows the rest of the form once a template is picked.
  const showForm = source !== 'existing' || template !== null;

  const usesPrep = category === 'piece';
  const templateOptions = templates.map((option) => ({
    key: option.id,
    label: option.name,
    photoFileName: option.photo_file_name,
    ...(option.category === 'prep' ? { detail: 'prep' } : {}),
    template: option,
  }));
  const canSave =
    !saving &&
    !gettingPhoto &&
    trimmedName !== '' &&
    endedAt >= startedAt &&
    (!finishing || photoUri !== null || trimmedNotes !== '');

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

  // Each source starts with no template and no prep.
  function chooseSource(value: Source) {
    setSource(value);
    setTemplate(null);
    setChosenPrep([]);
    setMissingPrep([]);
    if (value !== 'existing') setCategory(value);
  }

  // Fills in the new piece from the template. Nothing on the template changes.
  function chooseTemplate(chosen: Template) {
    getTemplatePrep(chosen.id)
      .then((uses) => {
        const prep = getTemplateChoices(uses);
        setTemplate(chosen);
        setName(chosen.name);
        setCategory(chosen.category);
        setChosenPrep(prep.chosen);
        setMissingPrep(prep.missing);
      })
      .catch(showError('Could not load the template'));
  }

  function save() {
    setSaving(true);
    withSavedPhoto(photoUri, (photoFileName) =>
      addPastWork({
        piece: { name: trimmedName, category, templateId: template?.id ?? null },
        startedAt: new Date(startedAt).toISOString(),
        endedAt: new Date(endedAt).toISOString(),
        photoFileName,
        finish: finishing ? { notes: trimmedNotes || null, lost: outcome === 'lost' } : null,
        prepUses: usesPrep ? chosenPrep.map(({ item, share }) => ({ prepId: item.id, share })) : [],
        supplyUses: chosenSupplies.map(({ item, share }) => ({ supplyId: item.id, share })),
      }),
    )
      .then(() => router.back())
      .catch((error: Error) => {
        setSaving(false);
        Alert.alert('Could not save', error.message);
      });
  }

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.page}>
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
          </View>
          <View style={styles.card}>
            <View style={styles.cardRow}>
              <Text style={[styles.text, styles.fill]}>Start</Text>
              <DateTimePicker
                value={new Date(startedAt)}
                mode="datetime"
                display="compact"
                accentColor={colors.primary}
                onValueChange={(_event, date) => setStartedAt(date.getTime())}
              />
            </View>
            <View style={[styles.cardRow, styles.separator]}>
              <Text style={[styles.text, styles.fill]}>End</Text>
              <DateTimePicker
                value={new Date(endedAt)}
                mode="datetime"
                display="compact"
                accentColor={colors.primary}
                onValueChange={(_event, date) => setEndedAt(date.getTime())}
              />
            </View>
          </View>
          {usesPrep && (
            <UseChoices
              kind="prep"
              usedBy={category}
              availableItems={availablePrep}
              chosen={chosenPrep}
              missing={missingPrep}
              onChange={setChosenPrep}
            />
          )}
          <UseChoices
            kind="supply"
            usedBy={category}
            availableItems={availableSupplies}
            chosen={chosenSupplies}
            onChange={setChosenSupplies}
          />
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
            {photoUri && <Image source={{ uri: photoUri }} style={styles.photo} />}
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
                  style={[styles.notesInput, styles.separator]}
                  value={notes}
                  onChangeText={setNotes}
                  placeholder={getNotesPlaceholder(outcome === 'lost', photoUri !== null)}
                  placeholderTextColor={colors.secondaryText}
                  multiline
                />
              </>
            )}
          </View>
          <View style={styles.buttonRow}>
            <Pressable
              style={[styles.saveButton, !canSave && styles.buttonDisabled]}
              onPress={() => confirmTemplateUseUp(usesPrep ? chosenPrep : [], save)}
              disabled={!canSave}
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
  nameInput: {
    fontSize: 18,
    paddingVertical: 12,
    color: colors.text,
  },
  notesInput: {
    fontSize: 18,
    paddingVertical: 12,
    height: 100,
    textAlignVertical: 'top',
    color: colors.text,
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
