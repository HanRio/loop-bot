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
const toSupabaseUrls = (urls) => urls.filter((u) => u.startsWith(SUPABASE));
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

test('sheet uses Oracle first and falls back to the function on 502, for the given page', async () => {
  const calls = stubFetch((url) => (url.startsWith(ORACLE) ? failing(502, 'upstream') : audio()));
  const blob = await createApi(SUPABASE, INIT_DATA, ORACLE).sheet(7, 2);

  assert.equal(await blob.text(), 'AUDIO');
  assert.equal(toOracle(calls)[0].url, `${ORACLE}/tracks/7/sheet/2`);
  assert.equal(toSupabase(calls)[0].url, `${SUPABASE}/tracks/7/sheet/2`);
});

test('uploadSheet POSTs the JPEG bytes to the function with initData and returns version and count', async () => {
  const jpeg = new Blob(['JPEG'], { type: 'image/jpeg' });
  const calls = stubFetch(() => new Response(JSON.stringify({ version: 2, count: 3 }), { status: 200 }));
  const result = await createApi(SUPABASE, INIT_DATA, ORACLE).uploadSheet(7, jpeg);

  assert.deepEqual(result, { version: 2, count: 3 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${SUPABASE}/tracks/7/sheet`);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.body, jpeg);
  assert.equal(calls[0].init.headers['Content-Type'], 'image/jpeg');
  assert.equal(calls[0].init.headers['X-Telegram-Init-Data'], INIT_DATA);
});

test('uploadSheet answers ApiError too_many on 409', async () => {
  stubFetch(() => failing(409, 'too_many'));

  await assert.rejects(createApi(SUPABASE, INIT_DATA, ORACLE).uploadSheet(7, new Blob(['J'])), (err) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.code, 'too_many');
    assert.equal(err.status, 409);
    return true;
  });
});

test('deleteSheet sends DELETE for the page and returns version and count', async () => {
  const calls = stubFetch(() => new Response(JSON.stringify({ version: 5, count: 2 }), { status: 200 }));
  const result = await createApi(SUPABASE, INIT_DATA, ORACLE).deleteSheet(7, 1);

  assert.deepEqual(result, { version: 5, count: 2 });
  assert.equal(calls[0].url, `${SUPABASE}/tracks/7/sheet/1`);
  assert.equal(calls[0].init.method, 'DELETE');
});

test('file sends initData to both Oracle and the function', async () => {
  const calls = stubFetch((url) => (url.startsWith(ORACLE) ? failing(502, 'upstream') : audio()));
  await createApi(SUPABASE, INIT_DATA, ORACLE).file(7);

  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.init.headers['X-Telegram-Init-Data'], INIT_DATA);
  }
});

test('file falls back to the function when Oracle sends no response headers in time', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  globalThis.fetch = (url, init) => {
    calls.push(url);
    if (!url.startsWith(ORACLE)) return Promise.resolve(audio());
    return new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
  };
  const pending = createApi(SUPABASE, INIT_DATA, ORACLE).file(7);
  t.mock.timers.tick(15000);

  assert.equal(await (await pending).text(), 'AUDIO');
  assert.equal(toSupabaseUrls(calls).length, 1);
});
