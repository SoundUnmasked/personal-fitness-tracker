import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  extractInBody,
  isAnthropicConfigured,
  AnthropicNotConfiguredError,
} from '@/lib/anthropic';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Cap uploads before buffering them into memory / sending to the vision API.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

// POST /api/inbody/extract  (multipart form-data)
//   fields: photo (file, required), save ("true" to persist a body_comp row)
// Returns the extracted JSON; when save=true also writes an InBody row.
export async function POST(req: NextRequest) {
  if (!isAnthropicConfigured()) {
    return NextResponse.json(
      {
        error:
          'ANTHROPIC_API_KEY not configured. Add it to .env to enable extraction.',
        configured: false,
      },
      { status: 503 },
    );
  }

  // Reject oversized uploads up front with a clear 413. (Next's middleware
  // body limit already truncates bodies >10 MB, which would otherwise surface
  // as a confusing multipart parse failure.) The small allowance on top of the
  // cap is for multipart framing overhead; file.size below is the exact check.
  const contentLength = Number(req.headers.get('content-length') ?? '0');
  if (contentLength > MAX_UPLOAD_BYTES + 64 * 1024) {
    return NextResponse.json(
      { error: 'photo must be 10 MB or smaller' },
      { status: 413 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: 'Expected multipart/form-data' },
      { status: 400 },
    );
  }

  const file = form.get('photo');
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: 'photo file is required' },
      { status: 400 },
    );
  }

  const mediaType = file.type || 'image/jpeg';
  if (!mediaType.startsWith('image/')) {
    return NextResponse.json(
      { error: 'photo must be an image' },
      { status: 400 },
    );
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: 'photo must be 10 MB or smaller' },
      { status: 413 },
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const base64 = buf.toString('base64');

  let extracted;
  try {
    extracted = await extractInBody(base64, mediaType);
  } catch (err) {
    if (err instanceof AnthropicNotConfiguredError) {
      return NextResponse.json(
        { error: err.message, configured: false },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: (err as Error).message || 'Extraction failed' },
      { status: 502 },
    );
  }

  let saved = null;
  if (form.get('save') === 'true') {
    const date = extracted.date ? new Date(extracted.date) : new Date();
    saved = await prisma.bodyComposition.create({
      data: {
        date: Number.isNaN(date.getTime()) ? new Date() : date,
        source: 'InBody',
        weightKg: extracted.weight_kg,
        bodyFatPct: extracted.body_fat_pct,
        skeletalMuscleMassKg: extracted.skeletal_muscle_mass_kg,
        visceralFat: extracted.visceral_fat,
        bmr: extracted.bmr,
        raw: JSON.stringify(extracted),
      },
    });
  }

  return NextResponse.json({ extracted, saved });
}
