import { describe, it, expect } from 'vitest';
import { parseJsonResponse } from '@/lib/anthropic';

describe('parseJsonResponse', () => {
  it('parses clean JSON', () => {
    const out = parseJsonResponse(
      '{"date":"2026-04-01","weight_kg":89,"body_fat_pct":17.9,"skeletal_muscle_mass_kg":42.2,"visceral_fat":null,"bmr":1800,"raw":{}}',
    );
    expect(out.weight_kg).toBe(89);
    expect(out.body_fat_pct).toBe(17.9);
    expect(out.skeletal_muscle_mass_kg).toBe(42.2);
    expect(out.bmr).toBe(1800);
    expect(out.date).toBe('2026-04-01');
  });

  it('strips markdown code fences', () => {
    const out = parseJsonResponse(
      '```json\n{"weight_kg":"90.5","raw":{}}\n```',
    );
    expect(out.weight_kg).toBe(90.5); // coerces numeric strings
  });

  it('extracts JSON embedded in prose', () => {
    const out = parseJsonResponse(
      'Here is the data: {"weight_kg":88,"raw":{}} hope that helps',
    );
    expect(out.weight_kg).toBe(88);
  });

  it('defaults missing fields to null and raw to {}', () => {
    const out = parseJsonResponse('{"weight_kg":80}');
    expect(out.body_fat_pct).toBeNull();
    expect(out.raw).toEqual({});
  });

  it('throws when no JSON present', () => {
    expect(() => parseJsonResponse('no json here')).toThrow();
  });
});
