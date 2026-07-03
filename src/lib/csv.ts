import type { CellValue, Sheet } from './export';

function cell(v: CellValue): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  // RFC 4180: quote when the value contains a comma, quote, or newline.
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** One sheet → CSV text. */
export function sheetToCsv(sheet: Sheet): string {
  const lines = [sheet.headers.map(cell).join(',')];
  for (const row of sheet.rows) lines.push(row.map(cell).join(','));
  return lines.join('\r\n') + '\r\n';
}

/**
 * All sheets → a single CSV, each preceded by a "# Sheet: <name>" marker and a
 * blank line. A real workbook (xlsx) keeps them as proper tabs; this combined
 * CSV is the dependency-free fallback for a quick glance / grep.
 */
export function sheetsToCombinedCsv(sheets: Sheet[]): string {
  return sheets
    .map((s) => `# Sheet: ${s.name}\r\n${sheetToCsv(s)}`)
    .join('\r\n');
}
