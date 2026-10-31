import { Directory, File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';

function getPhotoDirectory() {
  const directory = new Directory(Paths.document, 'photos');
  directory.create({ idempotent: true });
  return directory;
}

export async function savePhoto(temporaryUri: string): Promise<string> {
  const source = new File(temporaryUri);
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${source.extension}`;
  await source.copy(new File(getPhotoDirectory(), fileName));
  return fileName;
}

export function deletePhoto(fileName: string) {
  new File(getPhotoDirectory(), fileName).delete();
}

export async function saveToCameraRoll(uri: string) {
  const { granted } = await MediaLibrary.requestPermissionsAsync(true);
  if (granted) await MediaLibrary.Asset.create(uri);
}
