import { NextRequest, NextResponse } from 'next/server';
import { buildExportSheets } from '@/lib/export';
import { sheetToCsv, sheetsToCombinedCsv } from '@/lib/csv';
import { buildXlsx } from '@/lib/xlsx';
import { isoDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

// Map short ?tab= slugs to sheet names.
const TAB_SLUGS: Record<string, string> = {
  run: 'Run Sessions',
  gym: 'Gym Sessions',
  weekly: 'Weekly Summary',
  body: 'Body Measurements',
};

/**
 * GET /api/export
 *   ?format=xlsx (default)  → one .xlsx workbook with all four tabs
 *   ?format=csv             → combined .csv (all tabs, section markers)
 *   ?format=csv&tab=run|gym|weekly|body → a single tab as .csv
 *
 * One-way export only (app → file). There is no import counterpart.
 */
export async function GET(req: NextRequest) {
  const format = (req.nextUrl.searchParams.get('format') ?? 'xlsx').toLowerCase();
  const tab = req.nextUrl.searchParams.get('tab')?.toLowerCase();
  const stamp = isoDate(new Date());
  const sheets = await buildExportSheets();

  if (format === 'csv') {
    if (tab) {
      const name = TAB_SLUGS[tab];
      const sheet = name && sheets.find((s) => s.name === name);
      if (!sheet) {
        return NextResponse.json(
          { error: `Unknown tab "${tab}". Use one of: ${Object.keys(TAB_SLUGS).join(', ')}` },
          { status: 400 },
        );
      }
      return fileResponse(
        sheetToCsv(sheet),
        `logbook-${tab}-${stamp}.csv`,
        'text/csv; charset=utf-8',
      );
    }
    return fileResponse(
      sheetsToCombinedCsv(sheets),
      `logbook-${stamp}.csv`,
      'text/csv; charset=utf-8',
    );
  }

  if (format === 'xlsx') {
    const buf = buildXlsx(sheets);
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'content-type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename="logbook-${stamp}.xlsx"`,
      },
    });
  }

  return NextResponse.json(
    { error: `Unknown format "${format}". Use "xlsx" or "csv".` },
    { status: 400 },
  );
}

function fileResponse(body: string, filename: string, contentType: string) {
  return new NextResponse(body, {
    status: 200,
    headers: {
      'content-type': contentType,
      'content-disposition': `attachment; filename="${filename}"`,
    },
  });
}
