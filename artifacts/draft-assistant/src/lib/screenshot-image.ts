import type { LineupScreenshotInput } from '@workspace/api-client-react';

/** Transient only. Re-encode to remove metadata and bound dimensions/request size. */
export async function prepareScreenshot(file: File): Promise<LineupScreenshotInput> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
    throw new Error('Choose a PNG, JPEG or WebP screenshot.');
  if (file.size > 12 * 1024 * 1024) throw new Error('Choose a screenshot under 12 MB, or crop it first.');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    if (!img.naturalWidth || !img.naturalHeight || img.naturalWidth * img.naturalHeight > 60_000_000)
      throw new Error('This image is too large. Crop it to the opponent’s lineup first.');
    const scale = Math.min(1, 2600 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser could not prepare the screenshot. Try another browser.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const imageBase64 = canvas.toDataURL('image/jpeg', .94).split(',')[1]!;
    if (imageBase64.length > 5592408) throw new Error('This screenshot is still too large. Crop it to the roster column and try again.');
    return { mimeType: 'image/jpeg', imageBase64 };
  } catch (error) {
    if (error instanceof Error && error.name === 'EncodingError') throw new Error('The screenshot could not be opened. Choose a valid PNG, JPEG or WebP image.');
    throw error;
  } finally { URL.revokeObjectURL(url); }
}
