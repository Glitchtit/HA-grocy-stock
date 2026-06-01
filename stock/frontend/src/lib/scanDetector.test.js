import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScanState, feedKey, flushIdle, looksLikeScan } from './scanDetector.js';

// Feed a string as a fast scanner burst (uniform gap), return the scan at Enter.
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

test('a slow prefix char in a separate input session is discarded', () => {
  const state = createScanState();
  feedKey(state, { key: 'a', time: 0 }); // lone char, then a long (new-session) gap
  let t = 1000; // 1s gap — clearly a separate input session
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

// --- Regression: Bluetooth HID jitter must NOT split a single barcode -------
// Reproduces the live bug where 5711953182419 was captured as 53182419 (the
// last 8 digits) because a ~300ms BT stall mid-scan reset the buffer.
test('a Bluetooth stall mid-scan does not truncate the barcode', () => {
  const state = createScanState();
  const barcode = '5711953182419';
  let t = 1000;
  for (let i = 0; i < barcode.length; i++) {
    feedKey(state, { key: barcode[i], time: t });
    // 300ms stall after the 5th digit, fast everywhere else
    t += i === 4 ? 300 : 20;
  }
  assert.equal(feedKey(state, { key: 'Enter', time: t }), '5711953182419');
});

test('flushIdle decodes a completed no-terminator burst (>= noTerminatorMinLen)', () => {
  const state = createScanState();
  let t = 0;
  for (const ch of '64114012') { feedKey(state, { key: ch, time: t }); t += 5; } // 8 chars
  assert.equal(flushIdle(state), '64114012');
});

test('flushIdle returns null for a short buffer', () => {
  const state = createScanState();
  let t = 0;
  for (const ch of '6411401') { feedKey(state, { key: ch, time: t }); t += 5; } // 7 chars
  assert.equal(flushIdle(state), null);
});

test('flushIdle rejects a long but slow (human-paced) buffer', () => {
  const state = createScanState();
  let t = 0;
  for (const ch of 'helloworld') { feedKey(state, { key: ch, time: t }); t += 200; } // 10 chars, slow
  assert.equal(flushIdle(state), null);
});

test('looksLikeScan is true for a fast >= minLen run, false for slow typing', () => {
  const fast = createScanState();
  let t = 0;
  for (const ch of '1234') { feedKey(fast, { key: ch, time: t }); t += 10; }
  assert.equal(looksLikeScan(fast), true);

  const slow = createScanState();
  t = 0;
  for (const ch of '1234') { feedKey(slow, { key: ch, time: t }); t += 250; }
  assert.equal(looksLikeScan(slow), false);
});
