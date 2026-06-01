import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScanState, feedKey, flushIdle } from './scanDetector.js';

// Helper: feed a string as a fast scanner burst, return the scan (or null) at Enter.
function scanBurst(text, { gap = 5, startTime = 1000 } = {}) {
  const state = createScanState();
  let t = startTime;
  for (const ch of text) {
    feedKey(state, { key: ch, time: t });
    t += gap;
  }
  return feedKey(state, { key: 'Enter', time: t });
}

test('fast burst followed by Enter decodes the full barcode', () => {
  assert.equal(scanBurst('6411401234567'), '6411401234567');
});

test('slow human typing is not treated as a scan', () => {
  const state = createScanState();
  let t = 0;
  for (const ch of 'hello') {
    feedKey(state, { key: ch, time: t });
    t += 250; // 250ms gaps — human speed
  }
  assert.equal(feedKey(state, { key: 'Enter', time: t }), null);
});

test('a slow prefix char is discarded; only the fast burst after the gap counts', () => {
  const state = createScanState();
  feedKey(state, { key: 'a', time: 0 }); // lone slow char, then a 500ms gap
  let t = 500;
  for (const ch of '123456') {
    feedKey(state, { key: ch, time: t });
    t += 5;
  }
  assert.equal(feedKey(state, { key: 'Enter', time: t }), '123456');
});

test('a burst shorter than minLen is rejected', () => {
  assert.equal(scanBurst('12'), null);
});

test('a non-character key breaks the burst', () => {
  const state = createScanState();
  let t = 0;
  for (const ch of '123') { feedKey(state, { key: ch, time: t }); t += 5; }
  feedKey(state, { key: 'Shift', time: t }); // resets
  t += 5;
  for (const ch of '45') { feedKey(state, { key: ch, time: t }); t += 5; }
  assert.equal(feedKey(state, { key: 'Enter', time: t }), null); // only '45' left
});

test('flushIdle decodes a completed fast burst that never sent a terminator', () => {
  const state = createScanState();
  let t = 0;
  for (const ch of '6411401') { feedKey(state, { key: ch, time: t }); t += 5; }
  assert.equal(flushIdle(state), '6411401');
});

test('flushIdle returns null when the buffer is too short', () => {
  const state = createScanState();
  feedKey(state, { key: '1', time: 0 });
  assert.equal(flushIdle(state), null);
});
