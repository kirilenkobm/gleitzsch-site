const ImportLimits = Object.freeze({ BYTES: 128 * 1024 * 1024, PIXELS: 120_000_000, EDGE: 65_536, HEADER: 4 * 1024 * 1024 });

function exifOrientation(bytes, start, end) {
  if (end - start < 14 || String.fromCharCode(...bytes.subarray(start, start + 4)) !== "Exif") return 1;
  const base = start + 6;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const little = bytes[base] === 0x49 && bytes[base + 1] === 0x49;
  if (!little && !(bytes[base] === 0x4d && bytes[base + 1] === 0x4d)) return 1;
  const directory = base + view.getUint32(base + 4, little);
  if (directory < base || directory + 2 > end) return 1;
  const count = view.getUint16(directory, little);
  for (let i = 0; i < count; i++) {
    const at = directory + 2 + i * 12;
    if (at + 12 > end) break;
    if (view.getUint16(at, little) === 0x112 && view.getUint16(at + 2, little) === 3
      && view.getUint32(at + 4, little) === 1) {
      const value = view.getUint16(at + 8, little);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

export function imageHeader(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71
    && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10) {
    return { width: view.getUint32(16), height: view.getUint32(20), orientation: 1, format: "PNG" };
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("Choose a JPEG or PNG photograph.");
  let orientation = 1;
  let dimensions = null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > bytes.length) break;
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > bytes.length) break;
    const start = offset + 2;
    // An APP1/XMP segment after EXIF must not erase the recorded orientation.
    if (marker === 0xe1 && length >= 8 && bytes[start] === 69 && bytes[start + 1] === 120
      && bytes[start + 2] === 105 && bytes[start + 3] === 102 && bytes[start + 4] === 0 && bytes[start + 5] === 0) {
      orientation = exifOrientation(bytes, start, offset + length);
    }
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 8) {
      dimensions = { height: view.getUint16(start + 1), width: view.getUint16(start + 3) };
    }
    offset += length;
  }
  if (!dimensions) throw new Error("Cannot safely read this JPEG header. Try a smaller JPEG or PNG copy.");
  const { width, height } = dimensions;
  return orientation >= 5 ? { width: height, height: width, orientation, format: "JPEG" }
    : { width, height, orientation, format: "JPEG" };
}

export function workingSize(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || Math.min(width, height) < 2
    || Math.max(width, height) > ImportLimits.EDGE || width > ImportLimits.PIXELS / height) {
    throw new Error("This photo is too large. Choose a smaller copy (up to 120 megapixels).");
  }
  const scale = Math.min(1, 720 / Math.min(width, height), 2048 / Math.max(width, height));
  const size = { width: Math.floor(width * scale), height: Math.floor(height * scale) };
  if (Math.min(size.width, size.height) < 2) throw new Error("This photo is too narrow. Choose another crop.");
  return size;
}

export async function openPhoto(file, isCurrent) {
  if (!file || file.size === 0 || file.size > ImportLimits.BYTES) throw new Error("Choose a JPEG or PNG smaller than 128 MiB.");
  const header = imageHeader(new Uint8Array(await file.slice(0, ImportLimits.HEADER).arrayBuffer()));
  const size = workingSize(header.width, header.height);
  if (!isCurrent()) return null;
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image", resizeWidth: size.width, resizeHeight: size.height,
    resizeQuality: "high", colorSpaceConversion: "default",
  });
  try {
    if (!isCurrent()) return null;
    const canvas = new OffscreenCanvas(size.width, size.height);
    const context = canvas.getContext("2d", { colorSpace: "srgb", willReadFrequently: true });
    context.fillStyle = "black";
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    return { ...size, pixels: context.getImageData(0, 0, size.width, size.height).data,
      originalWidth: header.width, originalHeight: header.height, format: header.format };
  } finally {
    bitmap.close();
  }
}

export function rotatePhoto(photo) {
  const pixels = new Uint8ClampedArray(photo.pixels.length);
  for (let y = 0; y < photo.height; y++) {
    for (let x = 0; x < photo.width; x++) {
      const source = (y * photo.width + x) * 4;
      const target = (x * photo.height + photo.height - 1 - y) * 4;
      pixels.set(photo.pixels.subarray(source, source + 4), target);
    }
  }
  return { ...photo, width: photo.height, height: photo.width, pixels };
}
