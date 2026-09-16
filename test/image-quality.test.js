import assert from "node:assert/strict";
import test from "node:test";
import { assessImageQuality, inspectJpeg, validateJpegBase64 } from "../lib/image-quality.js";

function jpeg(width, height) {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03,
    0x01, 0x11, 0x00,
    0x02, 0x11, 0x00,
    0x03, 0x11, 0x00,
    0xff, 0xd9,
  ]);
}

test("verifies JPEG signatures and reads dimensions", () => {
  const metadata = inspectJpeg(jpeg(1200, 800));
  assert.equal(metadata.width, 1200);
  assert.equal(metadata.height, 800);
  assert.equal(inspectJpeg(Buffer.from("not a jpeg")), null);
  assert.equal(validateJpegBase64(Buffer.from("hello").toString("base64")), null);
});

test("returns conservative image-quality findings", () => {
  const lowResolution = assessImageQuality({ width: 320, height: 240, bytes: 10_000 });
  const normal = validateJpegBase64(jpeg(1200, 800).toString("base64"));
  assert.equal(lowResolution.acceptable, false);
  assert.match(lowResolution.findings.join(" "), /Resolution is low/);
  assert.equal(normal.quality.acceptable, true);
});
