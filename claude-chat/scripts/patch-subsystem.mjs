#!/usr/bin/env node
/**
 * Patches a Windows PE executable to use the GUI subsystem (no console window).
 * Changes IMAGE_SUBSYSTEM_WINDOWS_CUI (3) → IMAGE_SUBSYSTEM_WINDOWS_GUI (2).
 *
 * Usage: node patch-subsystem.mjs <path-to-exe>
 */

import { readFileSync, writeFileSync } from "node:fs";

const exe = process.argv[2];
if (!exe) {
  console.error("Usage: node patch-subsystem.mjs <exe-path>");
  process.exit(1);
}

const buf = readFileSync(exe);

// DOS header: PE signature offset is at 0x3C
const peOffset = buf.readUInt32LE(0x3c);

// Verify PE signature "PE\0\0"
if (buf.toString("ascii", peOffset, peOffset + 4) !== "PE\0\0") {
  console.error(`${exe}: Not a valid PE file`);
  process.exit(1);
}

// Optional header starts 24 bytes after PE signature
// Subsystem field is at offset 68 (0x44) into the optional header
const subsystemOffset = peOffset + 24 + 68;
const current = buf.readUInt16LE(subsystemOffset);

if (current === 3) {
  // CUI → GUI
  buf.writeUInt16LE(2, subsystemOffset);
  writeFileSync(exe, buf);
  console.log(`Patched ${exe}: subsystem CUI → GUI (no console window)`);
} else if (current === 2) {
  console.log(`${exe}: already GUI subsystem, skipping`);
} else {
  console.log(`${exe}: unexpected subsystem value ${current}, skipping`);
}
