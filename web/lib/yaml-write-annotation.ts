// Surgical inserter for gotcha / s4_change list items under a table block.
// Same philosophy as lib/yaml-write.ts: only touch the lines we need to add,
// preserve every other byte (alignment, comments, flow-style spacing).
//
// Pure function. No fs, no Next imports — the API route handles IO.

export type ListAnnotationKind = "gotcha" | "s4_change" | "note";
// "note" is a free-form table-level prose field, not a list. Handled
// separately because the YAML key is `notes` (singular block scalar) not
// a list of items.

export interface AnnotationToInsert {
  kind: ListAnnotationKind;
  text: string;
  severity?: "low" | "medium" | "high";
}

const TABLE_ITEM_RE = /^  - id:\s+(\S+)/;
const TOP_LEVEL_RE = /^[A-Za-z]/;

export function insertAnnotation(
  yamlText: string,
  tableId: string,
  ann: AnnotationToInsert,
): string {
  const trailingNewline = yamlText.endsWith("\n");
  const lines = yamlText.split("\n");
  if (trailingNewline) lines.pop();

  const range = findTableRange(lines, tableId);
  if (!range) throw new Error(`table "${tableId}" not found`);
  const [tableStart, tableEnd] = range;

  if (ann.kind === "note") {
    return appendNote(lines, tableStart, tableEnd, ann.text, trailingNewline);
  }

  const yamlKey = ann.kind === "gotcha" ? "gotchas" : "s4_changes";
  const newItem = renderAnnotationItem(ann.text, ann.severity);
  const block = findListBlock(lines, tableStart + 1, tableEnd, yamlKey);

  if (block) {
    if (block.inline) {
      throw new Error(
        `cannot append to inline ${yamlKey}: list — convert to block style first`,
      );
    }
    lines.splice(block.endExclusive, 0, ...newItem);
  } else {
    const insertAt = lastNonTrailingLineIn(lines, tableStart + 1, tableEnd);
    lines.splice(insertAt, 0, `    ${yamlKey}:`, ...newItem);
  }

  return lines.join("\n") + (trailingNewline ? "\n" : "");
}

function findTableRange(
  lines: string[],
  tableId: string,
): [number, number] | null {
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(TABLE_ITEM_RE);
    if (m && m[1] === tableId) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (TABLE_ITEM_RE.test(lines[i]) || TOP_LEVEL_RE.test(lines[i])) {
      end = i;
      break;
    }
  }
  return [start, end];
}

interface BlockSpan {
  start: number;
  endExclusive: number; // first line *after* the block (or after trailing blanks)
  inline: boolean;
}

function findListBlock(
  lines: string[],
  from: number,
  to: number,
  yamlKey: string,
): BlockSpan | null {
  const blockRe = new RegExp(`^    ${yamlKey}:\\s*$`);
  const inlineRe = new RegExp(`^    ${yamlKey}:\\s*\\[`);
  for (let i = from; i < to; i++) {
    if (inlineRe.test(lines[i])) {
      return { start: i, endExclusive: i + 1, inline: true };
    }
    if (blockRe.test(lines[i])) {
      // A line stays in the block if it's blank or has 6+ space indent
      // (covers list items at 6 and item subkeys at 8+).
      let end = i + 1;
      while (
        end < to &&
        (lines[end].trim() === "" || /^ {6,}\S/.test(lines[end]))
      ) {
        end++;
      }
      while (end > i + 1 && lines[end - 1].trim() === "") end--;
      return { start: i, endExclusive: end, inline: false };
    }
  }
  return null;
}

function lastNonTrailingLineIn(
  lines: string[],
  from: number,
  to: number,
): number {
  let insertAt = to;
  while (insertAt > from) {
    const prev = lines[insertAt - 1];
    if (prev.trim() === "" || prev.trimStart().startsWith("#")) {
      insertAt--;
    } else {
      break;
    }
  }
  return insertAt;
}

function renderAnnotationItem(text: string, severity?: string): string[] {
  const trimmed = text.trim();
  if (trimmed.includes("\n")) {
    const out = [`      - text: |`];
    for (const line of trimmed.split("\n")) {
      out.push(`          ${line}`);
    }
    if (severity) out.push(`        severity: ${severity}`);
    return out;
  }
  // Single line — quote with double quotes, escape backslashes + quotes.
  const escaped = trimmed.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const out = [`      - text: "${escaped}"`];
  if (severity) out.push(`        severity: ${severity}`);
  return out;
}

function appendNote(
  lines: string[],
  tableStart: number,
  tableEnd: number,
  text: string,
  trailingNewline: boolean,
): string {
  // notes: is a block scalar (literal). Append the new text after a
  // separator paragraph.
  const noteRe = /^    notes:\s*\|/;
  let noteIdx = -1;
  for (let i = tableStart + 1; i < tableEnd; i++) {
    if (noteRe.test(lines[i])) {
      noteIdx = i;
      break;
    }
  }
  if (noteIdx === -1) {
    const insertAt = lastNonTrailingLineIn(lines, tableStart + 1, tableEnd);
    const newLines = [`    notes: |`, ...text.split("\n").map((l) => `      ${l}`)];
    lines.splice(insertAt, 0, ...newLines);
    return lines.join("\n") + (trailingNewline ? "\n" : "");
  }
  // Find end of the existing block scalar (lines with 6-space indent).
  let end = noteIdx + 1;
  while (
    end < tableEnd &&
    (lines[end].trim() === "" || /^      /.test(lines[end]))
  ) {
    end++;
  }
  while (end > noteIdx + 1 && lines[end - 1].trim() === "") end--;
  const appended = ["", ...text.split("\n").map((l) => `      ${l}`)];
  lines.splice(end, 0, ...appended);
  return lines.join("\n") + (trailingNewline ? "\n" : "");
}
