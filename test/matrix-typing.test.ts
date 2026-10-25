import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matrixTyping } from '../src/matrix-typing.js';
import { safeErrorSummary } from '../src/errors.js';

const options = { homeserver: 'https://matrix.example.com/', userId: '@bot:example.com', accessToken: 'test-token' };

test('typing PUT encodes identifiers, disables redirects and discards the response body', async () => {
  const signal = new AbortController().signal;
  let cancelled = false;
  const send = matrixTyping(options, async (url, init) => {
    assert.equal(url, 'https://matrix.example.com/_matrix/client/v3/rooms/!room%3Aexample.com/typing/%40bot%3Aexample.com');
    assert.equal(init?.method, 'PUT');
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.signal, signal);
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-token');
    assert.deepEqual(JSON.parse(String(init?.body)), { typing: true, timeout: 30_000 });
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  });
  await send('!room:example.com', true, 30_000, signal);
  assert.equal(cancelled, true);
});

test('request cancellation reaches transport and an already aborted send never starts', async () => {
  const controller = new AbortController();
  let calls = 0;
  const send = matrixTyping(options, async (_url, init) => {
    calls++;
    return new Promise((_, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true }));
  });
  const request = send('!room:example.com', true, 30_000, controller.signal);
  controller.abort();
  await assert.rejects(request, { name: 'AbortError' });
  await assert.rejects(send('!room:example.com', false, 30_000, controller.signal), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('HTTP failure exposes only status, never response content', async () => {
  let cancelled = false;
  const send = matrixTyping(options, async () => new Response(new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode('secret server response')); },
    cancel() { cancelled = true; },
  }), { status: 429 }));
  await assert.rejects(send('!room:example.com', false, 30_000, new AbortController().signal), error => {
    assert.equal(safeErrorSummary(error), 'Error, HTTP 429');
    assert.equal(String(error).includes('secret'), false);
    return true;
  });
  assert.equal(cancelled, true);
});
