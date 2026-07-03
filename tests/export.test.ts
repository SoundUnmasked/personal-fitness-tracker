import { describe, it, expect } from 'vitest';
import { sheetToCsv, sheetsToCombinedCsv } from '@/lib/csv';
import { buildXlsx } from '@/lib/xlsx';
import type { Sheet } from '@/lib/export';

const sheets: Sheet[] = [
  {
    name: 'Run Sessions',
    headers: ['Date', 'Distance (km)', 'Notes'],
    rows: [
      ['2026-06-20', 5.2, 'easy, felt good'],
      ['2026-06-22', 10, 'comma, in note'],
    ],
  },
  {
    name: 'Body Measurements',
    headers: ['Date', 'Source', 'Weight (kg)'],
    rows: [['2026-06-20', 'InBody', 89]],
  },
];

describe('CSV export', () => {
  it('serialises a sheet with a header row and numbers', () => {
    const csv = sheetToCsv(sheets[0]);
    expect(csv.split('\r\n')[0]).toBe('Date,Distance (km),Notes');
    // "easy, felt good" contains a comma → quoted.
    expect(csv).toContain('2026-06-20,5.2,"easy, felt good"');
  });

  it('quotes values containing commas', () => {
    const csv = sheetToCsv(sheets[0]);
    expect(csv).toContain('"comma, in note"');
  });

  it('combines sheets with section markers', () => {
    const csv = sheetsToCombinedCsv(sheets);
    expect(csv).toContain('# Sheet: Run Sessions');
    expect(csv).toContain('# Sheet: Body Measurements');
  });
});

describe('XLSX export', () => {
  it('produces a valid ZIP (PK header) with all parts', () => {
    const buf = buildXlsx(sheets);
    // ZIP local-file-header magic.
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK');
    const asText = buf.toString('latin1');
    // Central directory should list every required part.
    expect(asText).toContain('[Content_Types].xml');
    expect(asText).toContain('xl/workbook.xml');
    expect(asText).toContain('xl/worksheets/sheet1.xml');
    expect(asText).toContain('xl/worksheets/sheet2.xml');
    // End-of-central-directory record present.
    expect(asText).toContain('PK\x05\x06');
  });

  it('is non-trivial in size', () => {
    expect(buildXlsx(sheets).length).toBeGreaterThan(500);
  });
});
