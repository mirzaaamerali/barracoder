# Security status — read before deploying

**Status: NOT CLEARED for deployment against a shared API key.**
The code is complete and careful. The blocker is which Anthropic account funds it.

Four rounds of adversarial review were run against this Worker (2026-08-11). The
final round *executed* the handler rather than reading it, and demonstrated the
problem below empirically.

## The finding that gates deployment

Cloudflare KV cannot do atomic counters. Every quota here is a read-modify-write:
read N, write N+1. Ten simultaneous requests all read the same N and all write
N+1, so the counter advances by one while ten requests bill.

Measured, by running the real handler: **10 concurrent requests all reached the
Anthropic API while the monthly counter recorded 1.**

Consequences with the caps as written:

| Scenario | Monthly spend |
|---|---|
| Normal use (a few coaches) | ~$1 |
| Sequential abuse | ~$8 |
| **Concurrent abuse** | **~$82** |

Native rate-limit bindings narrow the window but do not close it — they are
approximate across Cloudflare locations, and the global limiter still admits its
whole allowance simultaneously.

## Why this is an account problem, not a code problem

No practical amount of Worker code fixes it. Atomic counting needs Durable
Objects (a different storage primitive), and even then the Worker is not the
last line of defence — the Anthropic-side spend limit is, because it is the only
cap an attacker cannot route around.

That is exactly why the funding account matters:

- **On a dedicated account with its own spend limit** — the brakes below become
  defence-in-depth. Worst case is that the account hits its cap and the robotics
  helper stops working. Nothing else is affected. **This is fine to deploy.**
- **On a key sharing an org-wide cap with production systems** — the worst case
  is that a kids' website exhausts the org budget and production API keys stop
  working. **Do not deploy this way.**

## What the Worker does do well

These all survived review and are genuinely solid:

- **No arbitrary prompts.** Three fixed tasks; the system prompt and user message
  are built server-side. The `ask` context is fetched by the Worker from our own
  `meetings.json` — the caller supplies only a question.
- **Prompt-injection containment.** Caller text is escaped and wrapped in
  `<untrusted_data>` tags the system prompt marks as data, never instructions.
  Callers cannot break out of the wrapper.
- **No data leakage.** The leak-focused review came back clean: all 24 log sites
  carry only request ids, status codes and counts. Upstream error bodies are
  never logged (they can echo caller text back). The API key appears only as an
  outbound header.
- **Fails closed.** A missing binding, a KV outage, or a failed spend write
  returns 503 and makes no API call.
- **Reserve-then-reconcile spend accounting.** Cost is charged before the call
  and refunded after success, because aborting a fetch does not un-bill tokens.
- **Kill switch** (`DISABLED` secret) and a hardcoded retirement date
  (2027-01-15) so a forgotten endpoint cannot bill anyone next year.

## Known residual issues

Accepted, and acceptable **only** behind a dedicated capped account:

1. Concurrency defeats the KV counters (above). Fix: Durable Objects.
2. `costCents()` ignores `cache_creation_input_tokens` / `cache_read_input_tokens`,
   so the `ask` task's cached digest is billed but under-counted.
3. The 3-chars-per-token reservation estimate is not a true upper bound for
   multi-byte scripts (CJK, Devanagari), which tokenise worse.
4. If Anthropic ever renames the `usage` fields, the refund path would refund a
   call that was genuinely billed.
5. The per-IP hourly counter is a fixed window, so 2× the limit is reachable
   across a boundary.
