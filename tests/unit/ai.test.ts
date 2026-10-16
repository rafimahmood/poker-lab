import { describe, expect, it } from 'vitest';
import { extractJson } from '../../src/ai/client';

describe('extractJson', () => {
  it('parses plain JSON', () => expect(extractJson('{"a":1}')).toEqual({ a: 1 }));
  it('strips code fences and chatter', () => {
    expect(extractJson('Sure!\n```json\n{"a":{"b":2}}\n```\nDone')).toEqual({ a: { b: 2 } });
  });
  it('throws on garbage', () => {
    expect(() => extractJson('no json here')).toThrow(/not valid JSON/);
    expect(() => extractJson('{broken')).toThrow(/not valid JSON/);
  });
});
