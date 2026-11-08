import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import { ActionSheetIOS, Alert } from 'react-native';

interface PhotoChoiceHandlers {
  canRemove: boolean;
  onPicked: (uri: string) => void;
  onRemove: () => void;

  onLoading?: (loading: boolean) => void;
}

function getPhotoDirectory() {
  const directory = new Directory(Paths.document, 'photos');
  directory.create({ idempotent: true });
  return directory;
}

async function savePhoto(temporaryUri: string): Promise<string> {
  const source = new File(temporaryUri);
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${source.extension}`;
  await source.copy(new File(getPhotoDirectory(), fileName));
  return fileName;
}

export function deletePhoto(fileName: string) {
  new File(getPhotoDirectory(), fileName).delete();
}

export async function withSavedPhoto<Saved>(
  temporaryUri: string | null,
  save: (photoFileName: string | null) => Promise<Saved>,
): Promise<Saved> {
  const photoFileName = temporaryUri ? await savePhoto(temporaryUri) : null;
  try {
    return await save(photoFileName);
  } catch (error) {
    if (photoFileName) deletePhoto(photoFileName);
    throw error;
  }
}

export async function saveToCameraRoll(uri: string) {
  const { granted } = await MediaLibrary.requestPermissionsAsync(true);
  if (granted) await MediaLibrary.Asset.create(uri);
}

export async function takePhoto() {
  const { granted } = await ImagePicker.requestCameraPermissionsAsync();
  const result = granted ? await ImagePicker.launchCameraAsync({ quality: 0.85 }) : null;
  if (!result || result.canceled) return null;
  const uri = result.assets[0].uri;
  await saveToCameraRoll(uri).catch((error: Error) =>
    Alert.alert('Could not save the photo to your camera roll', error.message),
  );
  return uri;
}

export async function choosePhoto() {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] });
  return result.canceled ? null : result.assets[0].uri;
}

export function showPhotoChoices({
  canRemove,
  onPicked,
  onRemove,
  onLoading,
}: PhotoChoiceHandlers) {
  const choices = [
    { label: 'Take photo', pick: takePhoto },
    { label: 'Choose from library', pick: choosePhoto },
  ];
  const options = choices.map(({ label }) => label);
  if (canRemove) options.push('Remove photo');
  options.push('Cancel');
  ActionSheetIOS.showActionSheetWithOptions(
    {
      options,
      cancelButtonIndex: options.length - 1,
      destructiveButtonIndex: canRemove ? choices.length : undefined,
    },
    (index) => {
      if (index < choices.length) {
        onLoading?.(true);
        choices[index]
          .pick()
          .then((uri) => uri && onPicked(uri))
          .catch((error: Error) => Alert.alert('Could not get the photo', error.message))
          .finally(() => onLoading?.(false));
      } else if (canRemove && index === choices.length) onRemove();
    },
  );
}

export function getPhotoUri(fileName: string) {
  return new File(getPhotoDirectory(), fileName).uri;
}
