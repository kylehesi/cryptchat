import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeCaptureError, describeMicError, describeOutputError } from '../../src/renderer/js/media/device-errors.js';

const dom = (name, message = 'raw browser text') => Object.assign(new Error(message), { name });

test('microphone errors say what happened and what to do, with the name kept', () => {
  assert.match(describeMicError(dom('NotAllowedError')), /Privacy & security → Microphone.*\[NotAllowedError\]$/);
  assert.match(describeMicError(dom('NotFoundError')), /no microphone found.*MIC_SRC \[NotFoundError\]$/);
  assert.match(describeMicError(dom('OverconstrainedError')), /selected one is gone/);
  assert.match(describeMicError(dom('NotReadableError')), /Another app may hold it exclusively/);
  assert.equal(describeMicError(dom('WeirdError', 'something odd')), 'something odd [WeirdError]', 'unknown: the raw text');
});

test('output and capture errors', () => {
  assert.equal(describeOutputError(dom('NotFoundError')), 'that device is no longer available [NotFoundError]');
  assert.match(describeCaptureError(dom('NotReadableError')), /closed, minimized, or protected/);
  assert.match(describeCaptureError(dom('NotFoundError')), /Press REFRESH/);
});
