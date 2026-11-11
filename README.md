# nk-wa-engine

Shared marker extraction/stripping core for NK's WhatsApp AI bots — currently
`kng-engine` (KNG, Khao Noi Gym) and Kopi Desk (GOS). Scope is **deliberately
narrow**: this package owns the `[[MARKER]]` side-effect contract (parsing
structured signals out of an LLM reply, and stripping every marker-shaped
thing from the customer-visible text) — nothing else. Prompt-building stays
in each host app, because each is genuinely bespoke to its own business
model (KNG: one Muay Thai gym with Wix integration; GOS: multi-tenant,
config-driven for any business).

## Why this exists

Both hosts independently built the same mechanism — parse a hidden marker,
strip it before sending — with different code and different coverage. GOS's
version had the complete-bracket catch-all but was missing the
dangling-truncated-marker case (a marker cut off mid-payload by a
`max_tokens` cap), which is a real leak risk: a customer could see a raw
`[[RAISE_TICKET: some long rea` fragment. kng-engine's version already fixed
this via a second regex. This package is kng-engine's `lib/markers.js`,
promoted so both hosts get the fix and future ones don't diverge again.

## API

- `payload(text, name)` — captured string, or `null` if absent.
- `payloadAll(text, name)` — every occurrence of a repeatable marker, as a
  string array (empty payloads dropped).
- `present(text, name)` — boolean, for payload-less markers (e.g. `NO_REPLY`).
- `wantsAttachment(text, attId)` — dynamic `[[SEND_<ID>]]` check.
- `strip(text)` — remove every marker-shaped thing (complete, unknown,
  hallucinated, AND truncated-on-the-last-line), collapse resulting blank
  lines. Always safe to call on anything about to reach a customer.
- `hasResidue(text)` — true if any `[[` survived; for tests/assertions.
- `extractMarkers(text, schema)` — declarative form. `schema` maps an output
  key to `{ marker, multi?, presence? }`. Returns `{ markers, visibleText }`
  in one call. Prefer this over calling `payload`/`present` marker-by-marker.

## Consuming it

No npm registry is set up for this (private repo, two consumers so far) —
install directly from GitHub:

```json
"dependencies": {
  "nk-wa-engine": "github:nexkoins/nk-wa-engine#main"
}
```

Pin to a tag once this has more than one consumer depending on a specific
behavior — don't float both hosts on `main` long-term.

## Testing

```
npm test
```

Covers: parity with kng-engine's exact current call patterns, parity with
GOS's exact current `LlmMarkers` field set, and the truncation-leak fix.
