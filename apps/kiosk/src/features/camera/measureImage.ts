export interface ImageDimensions {
  width: number;
  height: number;
}

export type ImageMeasurer = (blob: Blob) => Promise<ImageDimensions>;

/**
 * Reads the real pixel dimensions of an encoded image, honouring EXIF
 * orientation, so reports show what the file contains rather than what was
 * requested.
 */
export const measureImage: ImageMeasurer = async (blob) => {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      const dims = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return dims;
    } catch {
      // Fall through to the <img> path (older Safari rejects the options bag).
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<ImageDimensions>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error('The captured image could not be decoded.'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
};
