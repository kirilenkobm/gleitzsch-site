const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
const encoder = new TextEncoder();
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});

export function photoSignature(version, website) {
  if (typeof version !== "string" || !/^[\x20-\x7e]+$/.test(version) || !website?.startsWith("https://")) {
    throw new Error("The photo export details could not be loaded. Reload the editor and try again.");
  }
  return Object.freeze({ software: `Gleitzsch ${version}`, description: `Processed with Gleitzsch — ${website}` });
}

function chunk(type, text) {
  const data = encoder.encode(text);
  const result = new Uint8Array(data.length + 12);
  const view = new DataView(result.buffer);
  view.setUint32(0, data.length);
  result.set(encoder.encode(type), 4);
  result.set(data, 8);
  let crc = 0xffffffff;
  for (const byte of result.subarray(4, result.length - 4)) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  view.setUint32(result.length - 4, (crc ^ 0xffffffff) >>> 0);
  return result;
}

// Only sign newly encoded rendered pixels, never an imported original file.
// Insert text after IHDR; preserve all encoded pixels and color chunks exactly.
export async function signedPng(blob, signature) {
  const header = new Uint8Array(await blob.slice(0, 33).arrayBuffer());
  if (header.length !== 33 || !pngSignature.every((byte, index) => header[index] === byte)
    || new DataView(header.buffer).getUint32(8) !== 13
    || String.fromCharCode(...header.subarray(12, 16)) !== "IHDR") {
    throw new Error("The frame could not be encoded as a PNG. Try saving again.");
  }
  return new Blob([
    blob.slice(0, 33),
    chunk("tEXt", `Software\0${signature.software}`),
    chunk("iTXt", `Description\0\0\0\0\0${signature.description}`),
    blob.slice(33),
  ], { type: "image/png" });
}
