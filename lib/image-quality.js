const START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

export function inspectJpeg(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  if (buffer[buffer.length - 2] !== 0xff || buffer[buffer.length - 1] !== 0xd9) return null;

  let offset = 2;
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) return null;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) return null;
    if (START_OF_FRAME_MARKERS.has(marker)) {
      if (length < 8) return null;
      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);
      if (!width || !height) return null;
      return { width, height, bytes: buffer.length };
    }
    offset += length;
  }
  return null;
}

export function assessImageQuality(metadata) {
  if (!metadata) {
    return { acceptable: false, score: 0, findings: ["File is not a decodable JPEG image."] };
  }
  const findings = [];
  const shortSide = Math.min(metadata.width, metadata.height);
  const longSide = Math.max(metadata.width, metadata.height);
  if (shortSide < 600) findings.push("Resolution is low; retake closer to the declaration panel.");
  if (longSide / shortSide > 4) findings.push("Image is unusually narrow; part of the panel may be cropped.");
  const density = metadata.bytes / (metadata.width * metadata.height);
  if (density < 0.015) findings.push("Image is highly compressed; small print may be unreadable.");

  return {
    acceptable: shortSide >= 480,
    score: Math.max(0, 100 - findings.length * 25 - (shortSide < 480 ? 35 : 0)),
    width: metadata.width,
    height: metadata.height,
    findings,
  };
}

export function validateJpegBase64(content) {
  if (typeof content !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(content)) return null;
  const buffer = Buffer.from(content, "base64");
  const metadata = inspectJpeg(buffer);
  return metadata ? { buffer, metadata, quality: assessImageQuality(metadata) } : null;
}
