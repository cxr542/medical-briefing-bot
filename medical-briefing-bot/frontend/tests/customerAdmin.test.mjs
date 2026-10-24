import assert from 'node:assert/strict';
import test from 'node:test';
import { mockUsers, validateEmployeeNumbers, validateMockPassword } from '../src/lib/customerAdminMockData.ts';

test('customer fixture has ten users with nine active and one inactive', () => {
  assert.equal(mockUsers.length, 10);
  assert.equal(mockUsers.filter(user => user.active).length, 9);
});

test('bulk registration rejects empty, malformed, duplicate and existing inactive numbers', () => {
  for (const input of ['', '\n  \n', '12345', '12a456', '100133\n100133', '100125']) {
    assert.ok(validateEmployeeNumbers(input, mockUsers).error, input);
  }
  assert.ok(validateEmployeeNumbers(Array.from({ length: 101 }, (_, index) => String(200000 + index)).join('\n'), mockUsers).error);
});

test('bulk registration handles CRLF and preserves leading zero without mutating fixtures', () => {
  assert.deepEqual(validateEmployeeNumbers(' 000123\r\n100133\r\n ', mockUsers), { numbers: ['000123', '100133'], error: '' });
  assert.equal(mockUsers.length, 10);
});

test('mock password validation requires length and matching confirmation', () => {
  assert.ok(validateMockPassword('short', 'short'));
  assert.ok(validateMockPassword('ui-only-example', 'different-example'));
  assert.equal(validateMockPassword('ui-only-example', 'ui-only-example'), '');
});
