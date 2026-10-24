import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const worker = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');

function harness(fetch, fallback) {
  const handlers = new Map();
  vm.runInNewContext(worker, {
    URL, Response, fetch,
    caches: { match: async () => fallback },
    self: { location: { origin: 'https://briefing.example' }, addEventListener: (name, callback) => handlers.set(name, callback) },
  });
  return (request) => {
    let response;
    handlers.get('fetch')({ request, respondWith: (value) => { response = value; } });
    return response;
  };
}

test('navigation returns the live response when online', async () => {
  const live = new Response('latest briefing');
  const dispatch = harness(async () => live, new Response('offline'));
  const result = await dispatch({ url: 'https://briefing.example/', method: 'GET', mode: 'navigate' });
  assert.equal(await result.text(), 'latest briefing');
});

test('failed navigation shows the offline explanation', async () => {
  const dispatch = harness(async () => { throw new TypeError('Offline'); }, new Response('connection explanation'));
  const result = await dispatch({ url: 'https://briefing.example/admin', method: 'GET', mode: 'navigate' });
  assert.equal(await result.text(), 'connection explanation');
});

test('worker leaves API, external data and mutations to the browser', () => {
  const dispatch = harness(() => assert.fail('unexpected intercepted fetch'));
  for (const request of [
    { url: 'https://briefing.example/api/articles', method: 'GET', mode: 'cors' },
    { url: 'https://project.supabase.co/rest/v1/articles', method: 'GET', mode: 'cors' },
    { url: 'https://briefing.example/admin', method: 'POST', mode: 'navigate' },
  ]) assert.equal(dispatch(request), undefined);
});
