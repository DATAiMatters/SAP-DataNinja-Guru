// Surgical line-based writer for table layout blocks.
//
// Why not the `yaml` library? It re-serializes the entire document, normalizing
// whitespace inside flow collections (`{name: X,  description: Y}` becomes
// `{name: X, description: Y}`) and column alignment. Our seed YAML uses both
// for human readability; reformatting on every save would make every diff
// noise. Surgical write only touches the layout: block bytes.
//
// Pure function — no fs, no Next-only imports. The API route handles IO so
// this stays unit-testable from a plain Node script.

export interface LayoutPatch {
  x: number;
  y: number;
  width?: number;
  height?: number;
}

const TABLE_ITEM_RE = /^  - id:\s+(\S+)/;
const TOP_LEVEL_RE = /^[A-Za-z]/;
const LAYOUT_BLOCK_RE = /^    layout:\s*$/;
const LAYOUT_INLINE_RE = /^    layout:\s*[{[]/;
// Lines inside a block-style layout map: 6+ space indent (covers 6-space
// child keys and any 8+ space deeper nesting).
const LAYOUT_INSIDE_RE = /^ {6,}\S/;

export function setTableLayout(
  yamlText: string,
  tableId: string,
  layout: LayoutPatch,
): string {
  const trailingNewline = yamlText.endsWith("\n");
  const lines = yamlText.split("\n");
  if (trailingNewline) lines.pop();

  const range = findTableRange(lines, tableId);
  if (!range) throw new Error(`table "${tableId}" not found`);
  const [tableStart, tableEnd] = range;
  const existing = findLayoutBlock(lines, tableStart + 1, tableEnd);
  const newBlock = renderLayoutBlock(layout);

  if (existing) {
    lines.splice(existing.start, existing.end - existing.start, ...newBlock);
  } else {
    let insertAt = tableEnd;
    while (insertAt > tableStart + 1) {
      const prev = lines[insertAt - 1];
      if (prev.trim() === "" || prev.trimStart().startsWith("#")) {
        insertAt--;
      } else {
        break;
      }
    }
    lines.splice(insertAt, 0, ...newBlock);
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

function findLayoutBlock(
  lines: string[],
  from: number,
  to: number,
): { start: number; end: number } | null {
  for (let i = from; i < to; i++) {
    if (LAYOUT_BLOCK_RE.test(lines[i])) {
      let end = i + 1;
      while (
        end < to &&
        (LAYOUT_INSIDE_RE.test(lines[end]) || lines[end].trim() === "")
      ) {
        end++;
      }
      while (end > i + 1 && lines[end - 1].trim() === "") end--;
      return { start: i, end };
    }
    if (LAYOUT_INLINE_RE.test(lines[i])) {
      return { start: i, end: i + 1 };
    }
  }
  return null;
}

function renderLayoutBlock(layout: LayoutPatch): string[] {
  const out = [
    "    layout:",
    `      x: ${Math.round(layout.x)}`,
    `      y: ${Math.round(layout.y)}`,
  ];
  if (layout.width != null) out.push(`      width: ${Math.round(layout.width)}`);
  if (layout.height != null) out.push(`      height: ${Math.round(layout.height)}`);
  return out;
}
