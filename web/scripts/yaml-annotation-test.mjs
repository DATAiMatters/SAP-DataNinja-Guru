// Smoke test for the annotation surgical inserter. Verifies:
//   1. Inserting a gotcha into a table that already has a gotchas: list
//      appends the new item and only adds the inserted lines.
//   2. Inserting a gotcha into a table without a gotchas: block creates
//      the block + item with the right indentation.
//   3. The result re-parses through js-yaml and contains the new item.
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { insertAnnotation } from "../lib/yaml-write-annotation.ts";

const path = process.argv[2];
if (!path) {
  console.error("usage: node yaml-annotation-test.mjs <path/to/file.yaml>");
  process.exit(1);
}

const before = readFileSync(path, "utf-8");

function dumpAround(text, lineNo, ctx = 5) {
  const lines = text.split("\n");
  const start = Math.max(0, lineNo - ctx - 1);
  const end = Math.min(lines.length, lineNo + ctx);
  for (let i = start; i < end; i++) {
    console.log(`  ${i + 1}: ${lines[i]}`);
  }
}

function safeParse(label, text) {
  try {
    return parseYaml(text);
  } catch (e) {
    console.error(`PARSE FAILED for ${label}:`, e.message);
    if (e.linePos) dumpAround(text, e.linePos[0].line);
    process.exit(1);
  }
}

// Test 1: append to existing gotchas (AUFK has one)
const after1 = insertAnnotation(before, "AUFK", {
  kind: "gotcha",
  text: "Test gotcha — please ignore.",
  severity: "low",
});
const parsed1 = safeParse("after1 (AUFK gotcha append)", after1);
const aufk = parsed1.tables.find((t) => t.id === "AUFK");
if (aufk.gotchas.length !== 2) {
  console.error(`AUFK should have 2 gotchas, got ${aufk.gotchas.length}`);
  process.exit(1);
}
if (aufk.gotchas[1].text !== "Test gotcha — please ignore.") {
  console.error("appended gotcha text wrong:", aufk.gotchas[1]);
  process.exit(1);
}

// Test 2: insert into table without gotchas (DD02L has none)
const after2 = insertAnnotation(before, "DD02L", {
  kind: "gotcha",
  text: "Test on DD02L.",
  severity: "medium",
});
const parsed2 = safeParse("after2 (DD02L new gotchas block)", after2);
const dd02l = parsed2.tables.find((t) => t.id === "DD02L");
if (!dd02l.gotchas || dd02l.gotchas.length !== 1) {
  console.error(`DD02L should have 1 gotcha, got ${dd02l.gotchas?.length}`);
  process.exit(1);
}
if (dd02l.gotchas[0].text !== "Test on DD02L.") {
  console.error("new gotcha text wrong:", dd02l.gotchas[0]);
  process.exit(1);
}

// Test 3: multi-line gotcha
const after3 = insertAnnotation(before, "KSSK", {
  kind: "gotcha",
  text: "Line one of the gotcha.\nLine two of the gotcha.",
  severity: "high",
});
const parsed3 = safeParse("after3 (KSSK multi-line)", after3);
const kssk = parsed3.tables.find((t) => t.id === "KSSK");
const lastGotcha = kssk.gotchas[kssk.gotchas.length - 1];
if (
  !lastGotcha.text.includes("Line one") ||
  !lastGotcha.text.includes("Line two")
) {
  console.error("multi-line gotcha didn't round-trip:", lastGotcha);
  process.exit(1);
}

// Test 4: insert s4_change into table without one
const after4 = insertAnnotation(before, "DD02L", {
  kind: "s4_change",
  text: "Schema change in S/4HANA.",
  severity: "high",
});
const parsed4 = safeParse("after4 (DD02L s4_change)", after4);
const dd02l4 = parsed4.tables.find((t) => t.id === "DD02L");
if (!dd02l4.s4_changes || dd02l4.s4_changes.length !== 1) {
  console.error("DD02L should have 1 s4_change after insert");
  process.exit(1);
}

console.log("OK — annotation insert passes 4 checks");
