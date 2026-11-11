import type { Drawable, SubjectBox } from '@accurova/image-engine';

export interface TestSubject {
  image: Drawable<CanvasImageSource>;
  subjectBox: SubjectBox;
  /** Says plainly what this is, for labels in admin tools. */
  description: string;
}

/**
 * A drawn stand-in for a segmented visitor, so the compositor and frame can be
 * previewed without a camera or a segmentation service. NOT a photograph.
 */
export function drawTestSubject(width = 1200, height = 1600): TestSubject {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const cx = width / 2;
  const top = height * 0.08;
  const bottom = height * 0.95;
  const bodyWidth = width * 0.3;

  ctx.fillStyle = '#3a2a26';
  ctx.beginPath();
  ctx.arc(cx, top + height * 0.07, height * 0.07, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#8e1b1b';
  ctx.beginPath();
  ctx.roundRect(cx - bodyWidth / 2, top + height * 0.15, bodyWidth, height * 0.38, width * 0.05);
  ctx.fill();
  ctx.fillStyle = '#2b3a55';
  ctx.fillRect(cx - bodyWidth * 0.42, top + height * 0.5, bodyWidth * 0.36, bottom - top - height * 0.5);
  ctx.fillRect(cx + bodyWidth * 0.06, top + height * 0.5, bodyWidth * 0.36, bottom - top - height * 0.5);

  return {
    image: { source: canvas, width, height },
    subjectBox: [Math.round(cx - bodyWidth / 2), Math.round(top), Math.round(cx + bodyWidth / 2), Math.round(bottom)],
    description: 'Drawn test figure (not a photograph)',
  };
}

/** Finds the bounds of non-transparent pixels in an uploaded cut-out. */
export async function subjectFromCutout(file: Blob): Promise<TestSubject> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 800 / Math.max(bitmap.width, bitmap.height));
  const probe = document.createElement('canvas');
  probe.width = Math.max(1, Math.round(bitmap.width * scale));
  probe.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = probe.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, probe.width, probe.height);
  const { data } = ctx.getImageData(0, 0, probe.width, probe.height);
  let left = probe.width;
  let top = probe.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < probe.height; y++) {
    for (let x = 0; x < probe.width; x++) {
      if (data[(y * probe.width + x) * 4 + 3]! >= 128) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) throw new Error('The image has no opaque pixels. Upload a PNG with a transparent background.');
  return {
    image: { source: bitmap, width: bitmap.width, height: bitmap.height },
    subjectBox: [
      Math.floor(left / scale),
      Math.floor(top / scale),
      Math.ceil((right + 1) / scale),
      Math.ceil((bottom + 1) / scale),
    ],
    description: 'Uploaded cut-out',
  };
}
