// InBody photo -> structured body_composition via Claude vision.
//
// Uses the Anthropic Messages API directly over fetch (no SDK dependency) so
// the build stays light. The model is asked for JSON ONLY and we defensively
// parse it. The API key is read from env and is a placeholder until you set it.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

export interface ExtractedBodyComp {
  date: string | null; // ISO date if visible on the scan, else null
  weight_kg: number | null;
  body_fat_pct: number | null;
  skeletal_muscle_mass_kg: number | null;
  visceral_fat: number | null;
  bmr: number | null;
  raw: Record<string, unknown>; // anything else the model pulled out
}

const SYSTEM_PROMPT = `You are a precise data-extraction tool for InBody body-composition scan photos.
Extract the printed metrics and return ONLY a single JSON object. No prose, no markdown, no code fences.
Use this exact shape (use null for anything not clearly visible; never guess):
{
  "date": string|null,                       // ISO 8601 (YYYY-MM-DD) if a test date is printed
  "weight_kg": number|null,                  // body weight in kilograms
  "body_fat_pct": number|null,               // percent body fat (PBF)
  "skeletal_muscle_mass_kg": number|null,    // SMM in kilograms
  "visceral_fat": number|null,               // visceral fat level/area
  "bmr": number|null,                        // basal metabolic rate (kcal)
  "raw": object                              // any other labelled values you can read, key->value
}
If the image is not an InBody/body-composition result, return the shape with all nulls and raw: {"note":"not an InBody scan"}.`;

export class AnthropicNotConfiguredError extends Error {
  constructor() {
    super(
      'ANTHROPIC_API_KEY is not set. Add it to .env to enable InBody extraction.',
    );
    this.name = 'AnthropicNotConfiguredError';
  }
}

export function isAnthropicConfigured(): boolean {
  const key = process.env.ANTHROPIC_API_KEY;
  return !!key && !key.includes('REPLACE_ME');
}

/**
 * Send a base64 image to Claude vision and parse the JSON it returns.
 * @param base64  base64-encoded image data (no data: prefix)
 * @param mediaType  e.g. "image/jpeg" | "image/png"
 */
export async function extractInBody(
  base64: string,
  mediaType: string,
): Promise<ExtractedBodyComp> {
  if (!isAnthropicConfigured()) throw new AnthropicNotConfiguredError();

  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY as string,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64 },
            },
            {
              type: 'text',
              text: 'Extract the body-composition values as JSON only.',
            },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Anthropic API error ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const text =
    data.content?.find((c) => c.type === 'text')?.text?.trim() ?? '';

  return parseJsonResponse(text);
}

/** Tolerant JSON parsing — strips code fences and grabs the outermost object. */
export function parseJsonResponse(text: string): ExtractedBodyComp {
  let cleaned = text.trim();
  // strip ```json ... ``` fences if the model added them anyway
  cleaned = cleaned.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error('Model did not return JSON.');
  }
  const obj = JSON.parse(cleaned.slice(start, end + 1));
  return normalize(obj);
}

function normalize(o: Record<string, unknown>): ExtractedBodyComp {
  const num = (v: unknown): number | null =>
    typeof v === 'number' && !Number.isNaN(v)
      ? v
      : typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))
        ? Number(v)
        : null;
  return {
    date: typeof o.date === 'string' ? o.date : null,
    weight_kg: num(o.weight_kg),
    body_fat_pct: num(o.body_fat_pct),
    skeletal_muscle_mass_kg: num(o.skeletal_muscle_mass_kg),
    visceral_fat: num(o.visceral_fat),
    bmr: num(o.bmr),
    raw:
      o.raw && typeof o.raw === 'object'
        ? (o.raw as Record<string, unknown>)
        : {},
  };
}
