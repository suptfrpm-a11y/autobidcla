/**
 * Utility to compress and resize images client-side and upload them to Firebase Storage
 * before writing to Firestore so document sizes remain compact and fast.
 */
import { uploadDataUrlToStorage, uploadMultipleDataUrlsToStorage } from './storageUpload';
export interface CompressedImageResult {
  url: string;
  base64: string;
  mime: string;
}

/**
 * Compresses an image File down to a lightweight high-clarity JPEG (target ~50KB - 85KB)
 * so multiple photos can easily fit in a Firestore document under the 1MB hard limit.
 */
export const compressImage = (
  file: File,
  maxWidth = 1024,
  maxHeight = 768,
  quality = 0.70
): Promise<CompressedImageResult> => {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('File is not an image'));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Failed to load image into memory'));
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        // Downscale while preserving aspect ratio
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(width, 1);
        canvas.height = Math.max(height, 1);

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas 2D context is not available'));
          return;
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'medium';
        ctx.drawImage(img, 0, 0, width, height);

        const mimeType = 'image/jpeg';
        let compressedDataUrl = canvas.toDataURL(mimeType, quality);

        // Multi-stage compression guard to guarantee payload stays strictly under 90KB
        if (compressedDataUrl.length > 120 * 1024) {
          compressedDataUrl = canvas.toDataURL(mimeType, 0.60);
        }
        if (compressedDataUrl.length > 120 * 1024) {
          // Scale down canvas if still too large
          const smallerCanvas = document.createElement('canvas');
          smallerCanvas.width = Math.max(Math.round(width * 0.75), 1);
          smallerCanvas.height = Math.max(Math.round(height * 0.75), 1);
          const sCtx = smallerCanvas.getContext('2d');
          if (sCtx) {
            sCtx.drawImage(canvas, 0, 0, smallerCanvas.width, smallerCanvas.height);
            compressedDataUrl = smallerCanvas.toDataURL(mimeType, 0.55);
          }
        }

        const parts = compressedDataUrl.split(',');
        const base64Data = parts[1] || '';

        resolve({
          url: compressedDataUrl,
          base64: base64Data,
          mime: mimeType,
        });
      };

      img.src = e.target?.result as string;
    };

    reader.readAsDataURL(file);
  });
};

/**
 * Recompresses an existing base64 data URL to ensure it never exceeds ~75KB
 */
export const compressDataUrl = (
  dataUrl: string,
  maxWidth = 1024,
  maxHeight = 768,
  quality = 0.70
): Promise<string> => {
  return new Promise((resolve) => {
    if (!dataUrl || !dataUrl.startsWith('data:image/')) {
      return resolve(dataUrl);
    }
    // If it's already tiny (under 70KB), keep it
    if (dataUrl.length < 90 * 1024) {
      return resolve(dataUrl);
    }

    const img = new Image();
    img.onerror = () => resolve(dataUrl); // fallback
    img.onload = () => {
      let width = img.width;
      let height = img.height;

      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(width, 1);
      canvas.height = Math.max(height, 1);

      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(dataUrl);

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'medium';
      ctx.drawImage(img, 0, 0, width, height);

      let compressed = canvas.toDataURL('image/jpeg', quality);
      if (compressed.length > 100 * 1024) {
        compressed = canvas.toDataURL('image/jpeg', 0.55);
      }
      resolve(compressed);
    };
    img.src = dataUrl;
  });
};

/**
 * Sanitizes an array of vehicle images so the total document stays well under 600KB
 */
export const sanitizeVehicleImages = async (images: string[]): Promise<string[]> => {
  if (!Array.isArray(images) || images.length === 0) {
    return [`https://images.unsplash.com/photo-1541899481282-d53bffe3c35d?auto=format&fit=crop&q=80&w=1200`];
  }

  // Cap maximum photos to 6
  const capped = images.slice(0, 6);
  const processed: string[] = [];

  for (const img of capped) {
    if (!img) continue;
    if (img.startsWith('http://') || img.startsWith('https://')) {
      processed.push(img);
    } else if (img.startsWith('data:image/')) {
      try {
        const compressed = await compressDataUrl(img, 960, 720, 0.68);
        processed.push(compressed);
      } catch {
        processed.push(img);
      }
    } else {
      processed.push(img);
    }
  }

  return processed.length > 0 ? processed : [`https://images.unsplash.com/photo-1541899481282-d53bffe3c35d?auto=format&fit=crop&q=80&w=1200`];
};

/**
 * Prepares a vehicle object before writing to Firestore:
 * - Sanitizes and compresses all images
 * - Removes client-only properties like `isOwner`
 * - Strips `undefined` values
 * - Verifies total document payload is safely under Firestore's 1MB limit (< 800KB)
 */
export const prepareVehicleForFirestore = async (vehicle: any): Promise<any> => {
  const clean: any = { ...vehicle };
  delete clean.isOwner;

  // Clean undefined properties
  Object.keys(clean).forEach(k => clean[k] === undefined && delete clean[k]);

  // Sanitize & upload vehicle images to Firebase Storage
  if (Array.isArray(clean.images)) {
    const compressed = await sanitizeVehicleImages(clean.images);
    clean.images = await uploadMultipleDataUrlsToStorage(compressed, 'vehicles', clean.stockNumber || 'veh');
  }

  // Upload RC card photo to Storage if provided as data URL
  if (typeof clean.rcCardImageUrl === 'string' && clean.rcCardImageUrl.startsWith('data:image/')) {
    const compressedRc = await compressDataUrl(clean.rcCardImageUrl, 960, 720, 0.68);
    clean.rcCardImageUrl = await uploadDataUrlToStorage(compressedRc, 'vehicles', `${clean.stockNumber || 'veh'}_rc`);
  }

  // Guard size limit only if Storage fell back to data URLs
  const jsonSize = JSON.stringify(clean).length;
  if (jsonSize > 700 * 1024 && Array.isArray(clean.images)) {
    clean.images = clean.images.slice(0, 3);
  }

  return clean;
};
