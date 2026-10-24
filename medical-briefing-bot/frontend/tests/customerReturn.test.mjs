import test from 'node:test';
import assert from 'node:assert/strict';
import { safeUserNext } from '../src/lib/customerReturn.ts';
test('user return path permits exact protected destinations only',()=>{
assert.equal(safeUserNext('/neurology-dashboard'),'/neurology-dashboard');
for(const value of ['/',undefined,'https://example.com','//example.com','/admin','/neurology-dashboard?redirect=https://example.com','/%2fexample.com','/\\example.com'])assert.equal(safeUserNext(value),'/');
});
