import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequest, listQuery, statusChange, message, customerDetail, databaseError } from '../src/lib/support/contract.ts';

test('business and database serialization conflicts preserve the public 409 contract', () => {
  for (const code of ['PT409', '40001']) {
    const error = databaseError(code);
    assert.equal(error.status, 409);
    assert.equal(error.code, 'VERSION_CONFLICT');
  }
  assert.equal(databaseError('XX000').status, 503);
});

test('request parsing rejects owner injection and invalid body boundaries', () => {
  for (const input of [
    { title: 'x', description: 'y', requester_admin_id: 'spoof' },
    { title: ' ', description: 'y' },
    { title: 'x'.repeat(201), description: 'y' },
    { title: 'x', description: 'y'.repeat(10001) },
    { title: 'x', description: 'bad\u0000text' },
  ]) assert.equal(createRequest.safeParse(input).success, false);
  assert.deepEqual(createRequest.parse({ title: ' test ', description: ' details ' }), { title: 'test', description: 'details', priority: 'normal' });
});

test('pagination and mutation schemas reject malformed or unbounded inputs', () => {
  for (const query of [{ page: '0' }, { page: '-1' }, { page: '1e2' }, { page_size: '51' }, { status: 'done' }, { owner: 'spoof' }]) assert.equal(listQuery.safeParse(query).success, false);
  assert.deepEqual(listQuery.parse({}), { page: 1, page_size: 20 });
  assert.equal(statusChange.safeParse({ status: 'reviewing', reason: '', version: 1 }).success, false);
  assert.equal(statusChange.safeParse({ status: 'reviewing', reason: 'reason', version: 1.5 }).success, false);
  assert.equal(message.safeParse({ body: 'answer', version: 0 }).success, false);
});

test('customer DTO strips internal fields at every response level', () => {
  const input = {
    request: { id: '11111111-1111-4111-8111-111111111111', request_number: 1, title: 'test', description: 'text', status: 'received', priority: 'normal', version: 1, created_at: 'now', updated_at: 'now', closed_at: null, requester_admin_id: 'PRIVATE', notes: ['PRIVATE'] },
    comments: [{ id: '22222222-2222-4222-8222-222222222222', author_type: 'internal_admin', body: 'answer', created_at: 'now', actor_id: 'PRIVATE' }], comments_total: 1, page: 1, page_size: 20,
    notes: ['PRIVATE'], audit: ['PRIVATE'], service_role_key: 'PRIVATE',
  };
  assert.equal(JSON.stringify(customerDetail.parse(input)).includes('PRIVATE'), false);
});
