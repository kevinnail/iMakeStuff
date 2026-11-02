import { Directory, File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';

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

function deletePhoto(fileName: string) {
  new File(getPhotoDirectory(), fileName).delete();
}

export async function withSavedPhoto(
  temporaryUri: string | null,
  save: (photoFileName: string | null) => Promise<void>,
) {
  const photoFileName = temporaryUri ? await savePhoto(temporaryUri) : null;
  try {
    await save(photoFileName);
  } catch (error) {
    if (photoFileName) deletePhoto(photoFileName);
    throw error;
  }
}

export async function saveToCameraRoll(uri: string) {
  const { granted } = await MediaLibrary.requestPermissionsAsync(true);
  if (granted) await MediaLibrary.Asset.create(uri);
}

export function getPhotoUri(fileName: string) {
  return new File(getPhotoDirectory(), fileName).uri;
}
