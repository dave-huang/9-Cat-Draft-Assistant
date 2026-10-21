import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ReadLineupScreenshotBody } from '@workspace/api-zod';
import { readScreenshot, validateScreenshot, ScreenshotError } from '../src/lib/lineup-screenshot';

const image = { mimeType: 'image/png' as const,
  imageBase64: Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]).toString('base64') };
const reading = { rows: [{ name: 'Nikola Jokic', slot: 'C', team: 'DEN', uncertain: false }], warnings: [] };
const providerResponse = (data: unknown, finishReason = 'STOP') => Response.json({
  candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify(data) }] } }],
});

test('image contract bounds types and bytes before a provider call', () => {
  assert.equal(ReadLineupScreenshotBody.safeParse(image).success, true);
  assert.equal(ReadLineupScreenshotBody.safeParse({ ...image, mimeType: 'image/svg+xml' }).success, false);
  assert.equal(ReadLineupScreenshotBody.safeParse({ ...image, imageBase64: 'x'.repeat(5592409) }).success, false);
  assert.throws(() => validateScreenshot({ ...image, imageBase64: '%%%%notanimage%%%' }), /Choose a PNG/);
  assert.throws(() => validateScreenshot({ ...image, mimeType: 'image/jpeg' }), /contents/);
  assert.throws(() => validateScreenshot({ ...image, imageBase64: Buffer.alloc(4 * 1024 * 1024 + 1).toString('base64') }), /smaller than 4 MB/);
  validateScreenshot(image);
});

test('Gemini uses server header credential, inline image, strict JSON and no tools', async () => {
  const calls: unknown[] = [];
  const fetcher: typeof fetch = async (url, options) => {
    assert.equal(String(url).startsWith('https://generativelanguage.googleapis.com/'), true);
    assert.equal(String(url).includes('gemini-3.8-flash:generateContent'), true);
    assert.equal(String(url).includes('test-key'), false);
    assert.equal((options?.headers as Record<string, string>)['x-goog-api-key'], 'test-key');
    const body = JSON.parse(String(options?.body)); calls.push(body);
    assert.equal(body.contents[0].parts[1].inlineData.data, image.imageBase64);
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, 'low');
    assert.equal(body.tools, undefined);
    return providerResponse(reading);
  };
  assert.deepEqual(await readScreenshot(image, { key: 'test-key', fetcher }), reading);
  assert.equal(calls.length, 1);
});

test('provider errors do not echo provider payloads, secrets or image data; never retry', async () => {
  for (const [status, expectedCode] of [[403, 'gemini_access_denied'], [429, 'gemini_rate_limit'], [500, 'gemini_unavailable']] as const) {
    let calls = 0;
    await assert.rejects(readScreenshot(image, { key: 'test-key', fetcher: async () => {
      calls++; return Response.json({ secret: 'DO-NOT-ECHO', image: image.imageBase64 }, { status });
    } }), (error: unknown) => error instanceof ScreenshotError && error.code === expectedCode && !error.message.includes('DO-NOT-ECHO') && !error.message.includes(image.imageBase64));
    assert.equal(calls, 1);
  }
  await assert.rejects(readScreenshot(image, { key: 'test-key', fetcher: async () => { throw new Error('DO-NOT-ECHO'); } }), /did not respond in time/);
});

test('provider configuration diagnostics are actionable without exposing provider text', async () => {
  for (const [status, message, code] of [
    [404, 'Model unavailable DO-NOT-ECHO', 'gemini_model_unavailable'],
    [400, 'API key not valid DO-NOT-ECHO', 'gemini_key_invalid'],
    [400, 'response_schema invalid DO-NOT-ECHO', 'gemini_request_invalid'],
    [400, 'Unsupported user location DO-NOT-ECHO', 'gemini_location_restricted'],
  ] as const) {
    await assert.rejects(readScreenshot(image, { key: 'test-key', fetcher: async () => Response.json({ error: { message } }, { status }) }),
      (e: unknown) => e instanceof ScreenshotError && e.code === code && !e.message.includes('DO-NOT-ECHO'));
  }
});

test('refusals, truncations, malformed JSON and invented slots fail explicitly', async () => {
  for (const response of [
    providerResponse(reading, 'MAX_TOKENS'),
    Response.json({ candidates: [] }),
    Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{not json' }] } }] }),
    providerResponse({ ...reading, rows: [{ ...reading.rows[0], slot: 'XYZ' }] }),
    providerResponse({ ...reading, rows: Array.from({ length: 19 }, () => reading.rows[0]) }),
  ]) {
    await assert.rejects(readScreenshot(image, { key: 'test-key', fetcher: async () => response }), /incomplete or unreadable/);
  }
});

test('non-lineup or empty image results do not produce a fake roster', async () => {
  await assert.rejects(readScreenshot(image, { key: 'test-key', fetcher: async () => providerResponse({ rows: [], warnings: ['Not a roster'] }) }),
    (e: unknown) => e instanceof ScreenshotError && e.status === 400 && e.code === 'no_lineup_found');
});
