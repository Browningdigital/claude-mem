#!/usr/bin/env node
/**
 * Generates icon.ico for the Claude Chat Windows app.
 * Creates a 32x32 and 16x16 icon with purple "C" on dark background.
 *
 * ICO format: https://en.wikipedia.org/wiki/ICO_(file_format)
 * This generates a minimal valid .ico without any image libraries.
 */

import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Colors
const BG = [10, 10, 10]; // #0a0a0a
const ACCENT = [196, 161, 255]; // #c4a1ff
const TRANSPARENT = [0, 0, 0, 0];

function createBMP(size) {
  // Create pixel data for a "C" letter icon
  const pixels = [];

  for (let y = size - 1; y >= 0; y--) {
    for (let x = 0; x < size; x++) {
      const cx = size / 2;
      const cy = size / 2;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const radius = size * 0.42;
      const innerRadius = size * 0.28;
      const angle = Math.atan2(dy, dx);

      // Ring (outer circle - inner circle), with a gap on the right for the "C"
      const inRing = dist <= radius && dist >= innerRadius;
      const isGap = angle > -0.7 && angle < 0.7; // gap on right side

      if (inRing && !isGap) {
        pixels.push(ACCENT[2], ACCENT[1], ACCENT[0], 255); // BGRA
      } else {
        pixels.push(BG[2], BG[1], BG[0], 255); // BGRA
      }
    }
  }

  return Buffer.from(pixels);
}

function buildICO(sizes) {
  const images = sizes.map((size) => {
    const pixels = createBMP(size);

    // BMP info header (BITMAPINFOHEADER) - 40 bytes
    const header = Buffer.alloc(40);
    header.writeUInt32LE(40, 0); // header size
    header.writeInt32LE(size, 4); // width
    header.writeInt32LE(size * 2, 8); // height (doubled for ICO)
    header.writeUInt16LE(1, 12); // planes
    header.writeUInt16LE(32, 14); // bits per pixel
    header.writeUInt32LE(0, 16); // compression (none)
    header.writeUInt32LE(pixels.length, 20); // image size

    // AND mask (1 bit per pixel, rows padded to 4 bytes)
    const maskRowBytes = Math.ceil(size / 8);
    const maskRowPadded = Math.ceil(maskRowBytes / 4) * 4;
    const andMask = Buffer.alloc(maskRowPadded * size, 0); // all opaque

    return { size, data: Buffer.concat([header, pixels, andMask]) };
  });

  // ICO header: 6 bytes
  const icoHeader = Buffer.alloc(6);
  icoHeader.writeUInt16LE(0, 0); // reserved
  icoHeader.writeUInt16LE(1, 2); // type: 1 = ICO
  icoHeader.writeUInt16LE(images.length, 4); // count

  // Directory entries: 16 bytes each
  let offset = 6 + images.length * 16;
  const entries = images.map((img) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(img.size === 256 ? 0 : img.size, 0); // width
    entry.writeUInt8(img.size === 256 ? 0 : img.size, 1); // height
    entry.writeUInt8(0, 2); // color palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(img.data.length, 8); // data size
    entry.writeUInt32LE(offset, 12); // data offset
    offset += img.data.length;
    return entry;
  });

  return Buffer.concat([icoHeader, ...entries, ...images.map((i) => i.data)]);
}

const ico = buildICO([16, 32]);
const outPath = join(__dirname, "icon.ico");
writeFileSync(outPath, ico);
console.log(`Created ${outPath} (${ico.length} bytes)`);
