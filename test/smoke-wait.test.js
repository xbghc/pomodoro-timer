'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { waitFor } = require('../scripts/lib/wait-for');
test('async polling checks the resolved value rather than a truthy Promise', async () => {
  let reads = 0;
  const value = await waitFor(async () => ({ phase: ++reads < 3 ? 'break' : 'waiting' }),
    async (state) => state.phase === 'waiting', { intervalMs: 1 });
  assert.equal(reads, 3); assert.equal(value.phase, 'waiting');
});
test('unsatisfied polling reports its final value rather than silently passing', async () => {
  await assert.rejects(waitFor(async () => 'break', (value) => value === 'waiting',
    { timeoutMs: 10, intervalMs: 1, description: 'rest completion' }), /rest completion.*break/);
});
test('polling propagates IPC and predicate failures', async () => {
  await assert.rejects(waitFor(async () => { throw new Error('IPC failed'); }, () => true), /IPC failed/);
  await assert.rejects(waitFor(async () => 1, async () => { throw new Error('check failed'); }), /check failed/);
});
