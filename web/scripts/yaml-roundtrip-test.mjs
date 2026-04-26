// Round-trip safety test: parse → serialize → diff. Ships in /web/scripts so
// CI can run it via `node scripts/yaml-roundtrip-test.mjs ../domains/<file>`.
//
// Exits non-zero on any byte-level difference. Prints up to 25 differing
// lines for triage.
import { readFileSync } from "node:fs";
import { parseDocument } from "yaml";

const target = process.argv[2];
if (!target) {
  console.error("usage: node yaml-roundtrip-test.mjs <path/to/file.yaml>");
  process.exit(1);
}

const before = readFileSync(target, "utf-8");
const doc = parseDocument(before);
const after = doc.toString({
  lineWidth: 0,
  flowCollectionPadding: false,
  doubleQuotedAsJSON: false,
  singleQuote: false,
});

if (before === after) {
  console.log(`OK: ${target} round-trips losslessly (${before.length} bytes)`);
  process.exit(0);
}

const beforeLines = before.split("\n");
const afterLines = after.split("\n");
const max = Math.max(beforeLines.length, afterLines.length);
let diffs = 0;
for (let i = 0; i < max; i++) {
  if (beforeLines[i] !== afterLines[i]) {
    diffs++;
    if (diffs <= 25) {
      console.log(`L${i + 1}:`);
      console.log(`  - ${JSON.stringify(beforeLines[i] ?? "<EOF>")}`);
      console.log(`  + ${JSON.stringify(afterLines[i] ?? "<EOF>")}`);
    }
  }
}
console.log(`\n${diffs} differing lines (showed first 25)`);
process.exit(1);
