'use strict';
const { setTimeout: delay } = require('node:timers/promises');
const { performance } = require('node:perf_hooks');

// Poll in Node so each async read is resolved before its value is tested.
async function waitFor(read, accept, { timeoutMs = 15_000, intervalMs = 50, description = 'condition' } = {}) {
  const deadline = performance.now() + timeoutMs;
  let last;
  do {
    last = await read();
    if (await accept(last)) return last;
    const remaining = deadline - performance.now();
    if (remaining <= 0) break;
    await delay(Math.min(intervalMs, remaining));
  } while (performance.now() < deadline);
  throw new Error(`Timed out waiting for ${description}; last value: ${JSON.stringify(last)}`);
}
module.exports = { waitFor };
