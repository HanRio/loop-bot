import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApi, ApiError } from '../../webapp/api.js';

const SUPABASE = 'https://supabase.test/functions/v1/loopbot-api';
const ORACLE = 'https://oracle.test';
const INIT_DATA = 'user=signed&hash=abc';
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

// 주소별 응답을 돌려주는 가짜 fetch. 호출 기록을 calls에 쌓는다.
function stubFetch(respond) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    const res = respond(url);
    if (res instanceof Error) throw res;
    return res;
  };
  return calls;
}

const audio = () => new Response('AUDIO', { status: 200 });
const failing = (status, error) => new Response(JSON.stringify({ error }), { status });
const toOracle = (calls) => calls.filter((c) => c.url.startsWith(ORACLE));
const toSupabase = (calls) => calls.filter((c) => c.url.startsWith(SUPABASE));

test('file uses Oracle and does not call the function when Oracle answers 200', async () => {
  const calls = stubFetch((url) => (url.startsWith(ORACLE) ? audio() : failing(500, 'upstream')));
  const blob = await createApi(SUPABASE, INIT_DATA, ORACLE).file(7);

  assert.equal(await blob.text(), 'AUDIO');
  assert.equal(toSupabase(calls).length, 0);
});

test('file falls back to the function when Oracle answers 502', async () => {
  const calls = stubFetch((url) => (url.startsWith(ORACLE) ? failing(502, 'upstream') : audio()));
  const blob = await createApi(SUPABASE, INIT_DATA, ORACLE).file(7);

  assert.equal(await blob.text(), 'AUDIO');
  assert.equal(toSupabase(calls).length, 1);
});

test('file falls back to the function when the Oracle request throws', async () => {
  const calls = stubFetch((url) => (url.startsWith(ORACLE) ? new TypeError('network down') : audio()));
  const blob = await createApi(SUPABASE, INIT_DATA, ORACLE).file(7);

  assert.equal(await blob.text(), 'AUDIO');
  assert.equal(toSupabase(calls).length, 1);
});

for (const [status, code] of [[401, 'expired'], [403, 'forbidden'], [404, 'not_found'], [413, 'too_big']]) {
  test(`file throws ApiError ${code} and skips the function when Oracle answers ${status}`, async () => {
    const calls = stubFetch((url) => (url.startsWith(ORACLE) ? failing(status, code) : audio()));

    await assert.rejects(createApi(SUPABASE, INIT_DATA, ORACLE).file(7), (err) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.code, code);
      assert.equal(err.status, status);
      return true;
    });
    assert.equal(toSupabase(calls).length, 0);
  });
}

test('file uses only the function when no fileBase is given', async () => {
  const calls = stubFetch(() => audio());
  const blob = await createApi(SUPABASE, INIT_DATA).file(7);

  assert.equal(await blob.text(), 'AUDIO');
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.startsWith(SUPABASE));
});

test('file sends initData to both Oracle and the function', async () => {
  const calls = stubFetch((url) => (url.startsWith(ORACLE) ? failing(502, 'upstream') : audio()));
  await createApi(SUPABASE, INIT_DATA, ORACLE).file(7);

  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.init.headers['X-Telegram-Init-Data'], INIT_DATA);
  }
});
