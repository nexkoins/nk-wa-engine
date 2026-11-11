'use strict';

const assert = require('assert');
const m = require('../markers');

let passed = 0;
function check(label, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error('FAIL:', label);
    console.error(e);
    process.exitCode = 1;
  }
}

// ---- kng-engine parity: these are the exact calls index.js makes today ----

check('payload: present with a value', () => {
  assert.strictEqual(m.payload('hi [[CANCEL_REQUEST: Wed 8pm | going overseas]] bye', 'CANCEL_REQUEST'),
    'Wed 8pm | going overseas');
});

check('payload: absent marker returns null', () => {
  assert.strictEqual(m.payload('just a reply', 'CANCEL_REQUEST'), null);
});

check('present: payload-less marker', () => {
  assert.strictEqual(m.present('ok [[NO_REPLY]]', 'NO_REPLY'), true);
  assert.strictEqual(m.present('ok, no marker here', 'NO_REPLY'), false);
});

check('wantsAttachment: dynamic SEND_<ID> marker', () => {
  assert.strictEqual(m.wantsAttachment('here [[SEND_BOOKING_GUIDE]]', 'booking_guide'), true);
  assert.strictEqual(m.wantsAttachment('here you go', 'booking_guide'), false);
});

check('strip: removes a complete marker and collapses blank lines', () => {
  const out = m.strip('Thanks!\n\n\n[[RAISE_TICKET: angry about pricing]]');
  assert.strictEqual(out.includes('['), false);
  assert.strictEqual(/\n{3,}/.test(out), false);
});

check('strip: removes a client-invented / unknown marker (the catch-all)', () => {
  const out = m.strip('ok [[TOTALLY_MADE_UP: whatever]] bye');
  assert.strictEqual(out, 'ok  bye');
});

check('strip: removes a marker truncated by max_tokens on the last line', () => {
  // This is the exact failure mode kng-engine's header documents, and the
  // gap GOS's prior extraction had: a trailing marker cut off mid-payload
  // by a token limit, with no closing ]].
  const truncated = 'Sure, thanks for the payment!\n[[RAISE_TICKET: customer angry about pricing and asking for a ref';
  const out = m.strip(truncated);
  assert.strictEqual(m.hasResidue(out), false);
  // strip() does not trim trailing whitespace (matches kng-engine's original
  // behaviour exactly -- callers trim/send as-is); only check content.
  assert.strictEqual(out.trim(), 'Sure, thanks for the payment!');
});

// ---- GOS parity: same field names/semantics as the LlmMarkers it builds today ----

check('extractMarkers: reproduces GOS\'s current LlmMarkers extraction', () => {
  const GOS_SCHEMA = {
    name: { marker: 'NAME' },
    rememberFacts: { marker: 'REMEMBER', multi: true },
    escalate: { marker: 'RAISE_TICKET' },
    qualifiedLead: { marker: 'QUALIFIED_LEAD' },
    bookRequest: { marker: 'BOOK_REQUEST' },
    bookingConfirmed: { marker: 'BOOKING_CONFIRMED' },
    leadCategory: { marker: 'LEAD_CATEGORY' },
    location: { marker: 'LOCATION' },
  };
  const reply = "Great, you're all set for Tuesday 7pm!\n" +
    '[[NAME: Thomas]]\n' +
    '[[REMEMBER: repeat customer]]\n' +
    '[[REMEMBER: allergic to nuts]]\n' +
    '[[BOOKING_CONFIRMED: Tuesday 7pm]]\n' +
    '[[LOCATION: Tampines]]';
  const { markers, visibleText } = m.extractMarkers(reply, GOS_SCHEMA);
  assert.strictEqual(markers.name, 'Thomas');
  assert.deepStrictEqual(markers.rememberFacts, ['repeat customer', 'allergic to nuts']);
  assert.strictEqual(markers.bookingConfirmed, 'Tuesday 7pm');
  assert.strictEqual(markers.location, 'Tampines');
  assert.strictEqual(markers.escalate, undefined);
  assert.strictEqual(markers.qualifiedLead, undefined);
  assert.strictEqual(markers.bookRequest, undefined);
  assert.strictEqual(markers.leadCategory, undefined);
  assert.strictEqual(m.hasResidue(visibleText), false);
  assert.strictEqual(visibleText.trim(), "Great, you're all set for Tuesday 7pm!");
});

check('extractMarkers: fixes the truncation leak GOS had, same schema as above', () => {
  const GOS_SCHEMA = { escalate: { marker: 'RAISE_TICKET' } };
  const truncated = 'Thanks for letting me know.\n[[RAISE_TICKET: upset about the refund timeline and asking';
  const { visibleText } = m.extractMarkers(truncated, GOS_SCHEMA);
  assert.strictEqual(m.hasResidue(visibleText), false);
  assert.strictEqual(visibleText.trim(), 'Thanks for letting me know.');
});

check('extractMarkers: presence-only marker (NO_REPLY-style)', () => {
  const schema = { silent: { marker: 'NO_REPLY', presence: true } };
  assert.strictEqual(m.extractMarkers('[[NO_REPLY]]', schema).markers.silent, true);
  assert.strictEqual(m.extractMarkers('a normal reply', schema).markers.silent, false);
});

console.log(`${passed} test(s) passed.`);
