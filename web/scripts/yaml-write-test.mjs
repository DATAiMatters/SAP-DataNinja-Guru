// Smoke test for the surgical YAML writer. Verifies:
//   1. Writing a layout to a table without one inserts cleanly at end of block.
//   2. The diff against the original is exactly the inserted lines (no
//      reformatting elsewhere).
//   3. A second write to the same table updates the existing block in place.
//   4. The file remains valid YAML and the layout round-trips through
//      js-yaml parsing.
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { setTableLayout } from "../lib/yaml-write.ts";

const path = process.argv[2];
if (!path) {
  console.error("usage: node yaml-write-test.mjs <path/to/file.yaml>");
  process.exit(1);
}

const before = readFileSync(path, "utf-8");

// Test 1: insert
const after1 = setTableLayout(before, "KSSK", { x: 850, y: 400 });
const beforeLines = before.split("\n");
const afterLines = after1.split("\n");
const inserted = afterLines.length - beforeLines.length;
if (inserted !== 3) {
  console.error(`expected 3 inserted lines (layout: + x + y), got ${inserted}`);
  process.exit(1);
}

// Test 2: only the inserted lines differ
let diffCount = 0;
let i = 0;
let j = 0;
while (i < beforeLines.length && j < afterLines.length) {
  if (beforeLines[i] === afterLines[j]) {
    i++;
    j++;
  } else {
    // Skip the inserted line on the after side
    j++;
    diffCount++;
  }
}
if (diffCount !== 3) {
  console.error(`expected exactly 3 differing lines, got ${diffCount}`);
  process.exit(1);
}

// Test 3: update in place
const after2 = setTableLayout(after1, "KSSK", { x: 900, y: 450, width: 200 });
const after2Lines = after2.split("\n");
if (after2Lines.length !== afterLines.length + 1) {
  console.error(
    `expected +1 line (width added), got delta ${after2Lines.length - afterLines.length}`,
  );
  process.exit(1);
}

// Test 4: parse and verify the layout block
const parsed = parseYaml(after2);
const ksskTable = parsed.tables.find((t) => t.id === "KSSK");
if (!ksskTable?.layout) {
  console.error("KSSK has no layout after write");
  process.exit(1);
}
if (
  ksskTable.layout.x !== 900 ||
  ksskTable.layout.y !== 450 ||
  ksskTable.layout.width !== 200
) {
  console.error(
    "layout values wrong:",
    JSON.stringify(ksskTable.layout),
  );
  process.exit(1);
}

console.log("OK — surgical write passes all 4 checks");
console.log(`  - insert: +3 lines, only those 3 differ`);
console.log(`  - update: +1 line for new width key`);
console.log(`  - re-parsed layout: ${JSON.stringify(ksskTable.layout)}`);
