'use strict';

/*
 * markers.js — the [[marker]] contract, in ONE place, shared by every NK
 * WhatsApp AI bot (kng-engine today; Kopi Desk/GOS from here on).
 *
 * ORIGIN. This is kng-engine's lib/markers.js, promoted to a shared package.
 * kng-engine's own header explains the bug this exists to kill, verbatim,
 * because it is the whole reason this file is shaped the way it is:
 *
 *   Parsing and stripping were two hand-maintained lists: index.js parsed 7
 *   markers with 7 regexes, then stripped them with 7 MORE regexes. They
 *   stayed in sync only by vigilance. Miss one strip line and raw
 *   `[[RAISE_TICKET: customer angry about pricing]]` is delivered to the
 *   CUSTOMER.
 *
 *   Two ways that lands in production:
 *     1. A per-client-configurable persona/knowledge block appended to the
 *        prompt verbatim. A client who invents their own marker gets it
 *        leaked -- no code change required to break it.
 *     2. A capped max_tokens can TRUNCATE a trailing marker. The persona
 *        instructs the model to put markers on the VERY LAST LINE, so
 *        truncation lands exactly there, leaving a dangling
 *        `[[RAISE_TICKET: some long rea` that no closing-bracket regex
 *        matches.
 *
 *   THE DESIGN: parse what you handle, then strip ANYTHING marker-shaped.
 *   A catch-all cannot be forgotten. Unknown, hallucinated, client-invented
 *   and truncated markers are all swallowed rather than delivered.
 *
 * WHY THIS MATTERS FOR GOS SPECIFICALLY (2026-11-12): GOS's own prior
 * extraction (llmGateway.ts) had the complete-bracket catch-all
 * (`/\[\[[^\]]*\]\]/g`) but NOT the dangling-truncated-marker regex below --
 * and GOS caps `max_tokens: 300` on the same call that can emit a marker on
 * the last line, so the exact truncation failure mode above was live and
 * unguarded on real Kopi Desk customer traffic before this package.
 *
 * A registry alone would NOT fix this -- you can still forget to register.
 * Parse what you handle, strip EVERYTHING marker-shaped, no exceptions.
 */

// Markers at least one host handles today. Informational only: strip() does
// NOT consult this list, so an unlisted marker is still stripped. Kept as a
// union across hosts so a shared dashboard/test can sanity-check coverage,
// not because strip() needs it.
const HANDLED = [
  // kng-engine (KNG, Khao Noi Gym)
  'NAME', 'RAISE_TICKET', 'QUALIFIED_LEAD', 'LEAD_CATEGORY', 'BOOK_REQUEST',
  'BOOKING_CONFIRMED', 'INTRO_PAID', 'FREE_TRIAL_BOOKED', 'NO_REPLY',
  'RESCHEDULE_REQUEST', 'CANCEL_REQUEST',
  // GOS (Kopi Desk)
  'REMEMBER', 'LOCATION',
];

// [[NAME]] or [[NAME: payload]] -- tolerant of spacing and a missing colon,
// matching the original hand-written regexes both hosts used.
function rx(name) {
  return new RegExp('\\[\\[\\s*' + name + '\\s*:?\\s*([^\\]]*?)\\s*\\]\\]', 'i');
}

// Captured payload, or null when the marker is absent. '' when present but
// empty (e.g. `[[CANCEL_REQUEST: ]]`) -- callers treat that as falsy anyway.
function payload(text, name) {
  const m = String(text == null ? '' : text).match(rx(name));
  return m ? (m[1] || '').trim() : null;
}

// Every occurrence of a repeatable marker (e.g. GOS's [[REMEMBER: ...]], one
// reply can state several durable facts at once). Empty payloads are
// dropped, not returned as blank entries.
function payloadAll(text, name) {
  const g = new RegExp('\\[\\[\\s*' + name + '\\s*:?\\s*([^\\]]*?)\\s*\\]\\]', 'gi');
  const out = [];
  const s = String(text == null ? '' : text);
  let m;
  while ((m = g.exec(s))) {
    const v = (m[1] || '').trim();
    if (v) out.push(v);
  }
  return out;
}

// Is the marker present at all (for payload-less markers like NO_REPLY)?
function present(text, name) {
  return rx(name).test(String(text == null ? '' : text));
}

// Does the reply ask for this attachment? (SEND_<ID> is dynamic, per
// attachment -- deliberately NOT part of the declarative schema below.)
function wantsAttachment(text, attId) {
  const id = String(attId || '').toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  return new RegExp('\\[\\[\\s*SEND_' + id + '\\s*\\]\\]', 'i').test(String(text == null ? '' : text));
}

/*
 * Remove EVERY marker from customer-visible text. Catch-all by design.
 *   1. any complete [[...]] -- known, unknown, client-invented, hallucinated
 *   2. a dangling [[... on the final line -- a marker truncated by max_tokens
 *   3. collapse the blank lines the removals leave behind
 */
function strip(text) {
  return String(text == null ? '' : text)
    .replace(/\[\[[^\]]*\]\]/g, '')
    .replace(/\[\[[^\n]*$/, '')
    .replace(/\n{3,}/g, '\n\n');
}

// True if any marker-shaped residue survived. For tests/assertions.
function hasResidue(text) {
  return /\[\[/.test(String(text == null ? '' : text));
}

/*
 * extractMarkers(text, schema) -- the declarative, schema-driven form both
 * hosts should prefer over calling payload()/present() marker-by-marker.
 *
 * schema: { outputKey: { marker: 'MARKER_NAME', multi?: bool, presence?: bool } }
 *   - presence: true  -> boolean, via present()        (e.g. NO_REPLY)
 *   - multi: true      -> string[], via payloadAll()    (e.g. GOS's REMEMBER)
 *   - (default)         -> string | undefined, via payload()
 *
 * Extraction reads the ORIGINAL text for every key (not a progressively
 * mutated copy) -- this matches kng-engine's existing call pattern exactly
 * (several independent markers.payload(reply, 'X') calls against the same
 * `reply`), so swapping an existing host onto this function is a no-op for
 * any schema whose marker names don't overlap, which is true of every
 * marker either host defines today.
 *
 * Returns { markers, visibleText }. visibleText is always strip(text),
 * computed once, regardless of schema -- callers never need to call strip()
 * separately.
 */
function extractMarkers(text, schema) {
  const src = String(text == null ? '' : text);
  const markers = {};
  for (const key of Object.keys(schema || {})) {
    const def = schema[key] || {};
    const name = def.marker;
    if (!name) continue;
    if (def.presence) {
      markers[key] = present(src, name);
    } else if (def.multi) {
      markers[key] = payloadAll(src, name);
    } else {
      const v = payload(src, name);
      markers[key] = v === null || v === '' ? undefined : v;
    }
  }
  return { markers, visibleText: strip(src) };
}

module.exports = {
  HANDLED,
  payload,
  payloadAll,
  present,
  wantsAttachment,
  strip,
  hasResidue,
  extractMarkers,
};
