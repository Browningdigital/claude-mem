#!/usr/bin/env node
/**
 * Post-build script: embeds icon + metadata into the exe, then patches PE subsystem.
 * Usage: node scripts/patch-exe.mjs <exe-path> <ico-path>
 */

import { readFileSync, writeFileSync } from "node:fs";
const rceditMod = await import("rcedit");
const rcedit = rceditMod.default || rceditMod;

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

console.log("Done!");
