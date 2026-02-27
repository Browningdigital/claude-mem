#!/usr/bin/env node
/**
 * Post-build script: embeds icon + metadata into the exe, then patches PE subsystem.
 * Usage: node scripts/patch-exe.mjs <exe-path> <ico-path>
 */

import { readFileSync, writeFileSync } from "node:fs";
import rcedit from "rcedit";

const exe = process.argv[2] || "claude-chat.exe";
const ico = process.argv[3] || "icon.ico";

// Step 1: Embed icon and metadata via rcedit
console.log(`Embedding icon ${ico} into ${exe}...`);
try {
  await rcedit(exe, {
    icon: ico,
    "version-string": {
      ProductName: "Claude Chat",
      FileDescription: "Claude Chat Server",
      CompanyName: "Browning Digital",
    },
  });
  console.log("Icon and metadata embedded.");
} catch (err) {
  console.error("rcedit failed:", err.message);
  console.log("Skipping icon embed — exe still works, just has default icon.");
}

// Step 2: Patch PE subsystem CUI → GUI (hide console window)
console.log(`Patching PE subsystem...`);
const buf = readFileSync(exe);
const peOffset = buf.readUInt32LE(0x3c);

if (buf.toString("ascii", peOffset, peOffset + 4) !== "PE\0\0") {
  console.error(`${exe}: Not a valid PE file, skipping subsystem patch`);
  process.exit(0);
}

const subsystemOffset = peOffset + 24 + 68;
const current = buf.readUInt16LE(subsystemOffset);

if (current === 3) {
  buf.writeUInt16LE(2, subsystemOffset);
  writeFileSync(exe, buf);
  console.log(`Patched ${exe}: CUI → GUI (no console window)`);
} else if (current === 2) {
  console.log(`${exe}: already GUI subsystem`);
} else {
  console.log(`${exe}: unexpected subsystem value ${current}, skipping`);
}

console.log("Done!");
