import test from 'node:test';
import assert from 'node:assert/strict';
import { boardLabels, boardTransition, displayStatus } from '../src/lib/support/board.ts';
import { createDatabase, create, rpc, internalPayload } from './fixtures/supportDatabase.mjs';

test('all seven persisted states have three board labels', () => {
  const expected = { received: '접수', reviewing: '처리 중', in_progress: '처리 중', waiting_customer: '처리 중', on_hold: '처리 중', completed: '완료', cancelled: '완료' };
  for (const [status, label] of Object.entries(expected)) assert.equal(boardLabels[displayStatus(status)], label);
  assert.deepEqual(boardTransition('cancelled', 'processing'), []);
  assert.deepEqual(boardTransition('in_progress', 'received'), []);
});

test('board plans execute against unchanged migration RPC and retain audit/version checks', async () => {
  const db = await createDatabase();
  try {
    for (const prefix of [[], ['reviewing'], ['reviewing','in_progress'], ['reviewing','waiting_customer'], ['on_hold']]) {
      let { request } = await create(db);
      async function move(status) {
        const result = await rpc(db, 'internal', 'status', internalPayload({ request_id: request.id, status, reason: 'CSR test', version: request.version }));
        request = result.request;
      }
      for (const status of prefix) await move(status);
      const previousVersion = request.version;
      const steps = boardTransition(request.status, 'completed');
      for (const status of steps) await move(status);
      assert.equal(request.status, 'completed');
      assert.equal(request.version, previousVersion + steps.length);
      for (const status of boardTransition(request.status, 'processing')) await move(status);
      assert.equal(displayStatus(request.status), 'processing');
      await assert.rejects(rpc(db, 'internal', 'status', internalPayload({ request_id: request.id, status: 'in_progress', reason: 'stale', version: previousVersion })), { code: '40001' });
      const detail = await rpc(db, 'internal', 'detail', internalPayload({ request_id: request.id, page: 1, page_size: 50 }));
      assert.equal(detail.audit.filter(item => item.action === 'status_changed').length, prefix.length + steps.length + 1);
    }
  } finally { await db.close(); }
});
