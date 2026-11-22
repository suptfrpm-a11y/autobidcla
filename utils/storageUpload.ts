import { getStorage, ref, uploadString, getDownloadURL } from 'firebase/storage';
import { app, auth } from '../firebase';

let storageInstance: ReturnType<typeof getStorage> | null = null;

function getSafeStorage() {
  if (!storageInstance) {
    storageInstance = getStorage(app);
  }
  return storageInstance;
}

/**
 * Uploads a base64 data URL image to Firebase Storage under scoped paths
 * (e.g., vehicles/{uid}/{file} or kyc/{uid}/{file}).
 * Falls back to returning the original compressed URL only if Storage is unavailable
 * in the current environment so listings/uploads degrade gracefully instead of failing.
 */
export async function uploadDataUrlToStorage(
  dataUrl: string,
  folder: 'vehicles' | 'kyc' | 'banners' | 'avatars',
  fileNamePrefix = 'img'
): Promise<string> {
  if (!dataUrl || !dataUrl.startsWith('data:image/')) {
    return dataUrl;
  }

  const uid = auth.currentUser?.uid;
  if (!uid) {
    return dataUrl;
  }

  try {
    const storage = getSafeStorage();
    const safePrefix = fileNamePrefix.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'img';
    const extMatch = dataUrl.match(/^data:image\/([a-zA-Z0-9+]+);/);
    const ext = extMatch?.[1]?.replace('jpeg', 'jpg') || 'jpg';
    const objectPath = `${folder}/${uid}/${safePrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const storageRef = ref(storage, objectPath);

    await uploadString(storageRef, dataUrl, 'data_url');
    const downloadUrl = await getDownloadURL(storageRef);
    return downloadUrl;
  } catch (err) {
    console.warn(`[StorageUpload] Cloud Storage upload failed for ${folder}, keeping compressed payload fallback:`, err);
    return dataUrl;
  }
}

export async function uploadMultipleDataUrlsToStorage(
  urls: string[],
  folder: 'vehicles' | 'kyc' | 'banners' | 'avatars',
  prefix = 'photo'
): Promise<string[]> {
  if (!Array.isArray(urls) || urls.length === 0) return [];
  return Promise.all(
    urls.map((u, idx) => uploadDataUrlToStorage(u, folder, `${prefix}_${idx}`))
  );
}
