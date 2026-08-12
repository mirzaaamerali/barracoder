# Barracoder AI helper (Cloudflare Worker)

A small proxy so the team site can use Claude **without** putting an API key in a
public web page. The page calls this Worker; the Worker holds the key and calls
the Claude API.

It deliberately does **not** accept free-form prompts. It accepts structured input
for exactly three tasks and builds the prompt itself, so it can't be used as a
general-purpose Claude proxy by anyone who finds the URL.

| Task | What it does |
|------|--------------|
| `recap` | Turns a meeting's goals + ticked plan items into a parent-friendly recap |
| `tidy` | Cleans a rough journal note into a clear dated entry (no invented facts) |
| `ask` | Answers a question using only the season context the Worker builds itself |

> ## 🛑 Deploy gate
>
> **Do not deploy this against an API key whose spend cap is shared with anything
> you care about.** Four rounds of review — the last one executing the handler —
> showed that Cloudflare KV counters cannot bound a concurrent attacker: 10
> simultaneous requests all reached the API while the counter recorded 1.
> Worst case is ~$82/month, not the ~$3 the brakes aim for.
>
> On a **dedicated Anthropic account with its own spend limit** this is fine: the
> account cap is the real backstop, the brakes below are defence-in-depth, and
> the worst case is "the helper stops working."
>
> Full detail and the residual-issue list: **[SECURITY.md](SECURITY.md)**.

## ⚠️ Before you deploy: the spend situation

The Anthropic key belongs to an organisation whose spend limit is **$10/month,
org-wide**, shared with a real business's production API keys. Uncontrolled spend
here does not merely cost money — it takes production offline.

Because of that, **every binding below is required and the Worker fails closed
without it.** If the KV namespace or either rate-limit binding is missing,
`/v1/assist` returns `503 server_misconfigured` for every request and logs a
config error. There is no "runs without quotas" mode.

## Deploy

All four steps are mandatory. Steps 3 and 4 are not optional hardening — skip
either one and the endpoint refuses to serve.

```sh
cd worker

# 1. Auth — either run `npx wrangler login` (browser),
#    or export a token with Workers Scripts:Edit + Workers KV:Edit:
export CLOUDFLARE_API_TOKEN=...

# 2. Secrets — REQUIRED (piped so they never appear in shell history)
cat ~/.config/anthropic/barracoder-key | npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put TEAM_PASSCODE      # paste the team passcode when prompted

# 3. Quota + spend storage — REQUIRED
#    Backs the per-IP / daily / monthly request counters, the monthly dollar
#    budget, and the wrong-passcode counters.
npx wrangler kv namespace create RATE
#    -> paste the returned id into wrangler.toml, replacing
#       PASTE_NAMESPACE_ID_HERE. The placeholder is left uncommented on purpose
#       so this step cannot be skipped silently — deploy fails until it's real.

# 4. Burst limiters — REQUIRED (BOTH of them)
#    Already present in wrangler.toml as the [[ratelimits]] BURST and
#    BURST_GLOBAL blocks. Nothing to create; just don't remove either. BURST is
#    per IP, BURST_GLOBAL is site-wide — the per-IP one cannot cap concurrency
#    on its own, because 100 requests from 100 addresses all pass it at once.
#    Confirm both are there:
grep -A3 '\[\[ratelimits\]\]' wrangler.toml   # expect BURST and BURST_GLOBAL

# 5. Ship it
npx wrangler deploy
```

Then set the resulting URL in the site's `assets/ai.js` config call.

### Verifying the brakes are live

```sh
curl -s https://<worker>.workers.dev/healthz            # {"ok":true}

# With a wrong passcode, six times in a row from the same device: the sixth
# should come back 429 rate_limited, not 401.
# With the KV binding removed, /v1/assist should return 503 server_misconfigured.
```

## Bindings

| Binding | Kind | Required | Purpose |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | secret | ✅ | Claude API key |
| `TEAM_PASSCODE` | secret | ✅ | Shared team passcode |
| `RATE` | KV namespace | ✅ | Quota counters + monthly spend counter + brute-force counters |
| `BURST` | rate limiting | ✅ | Atomic burst limit, **per IP** (5 req / 60s) |
| `BURST_GLOBAL` | rate limiting | ✅ | Atomic burst limit, **site-wide** (10 req / 60s) — the one that actually caps concurrency |
| `DISABLED` | secret | optional | Kill switch — any non-empty value stops every request |

## The brakes, and what actually bounds the bill

Worst case per request at `claude-opus-5` rates ($5/M in, $25/M out), counted at
a pessimistic **3 characters per token**: 30000 prompt chars = 10000 input
tokens = $0.05, plus 1500 output tokens = $0.0375 → **~9 cents**.

| Brake | Value | Notes |
|---|---|---|
| Burst (per IP) | 5 req / 60s / IP | Cloudflare rate limiting binding — atomic, unlike KV |
| Burst (site-wide) | 10 req / 60s | The per-IP limiter can't serialise anything: 100 addresses pass it at once. This is what bounds the concurrency the KV counters see |
| Per-IP | 15 / hour | IPv6 addresses are keyed on their /64 prefix |
| Global daily | 20 / day | |
| Global monthly | 60 / month | Realistic use ≈ 1.75¢/request → about $1.05/month |
| **Monthly dollar budget** | **$3.00** | The real cap, applied as reserve-then-reconcile: a 9¢ worst case is added to the counter *before* the call and written back down to the actual `input×5 + output×25` cents only on success. Worst-case traffic stops after ~33 requests |
| Wrong passcode (per IP) | 5 / hour | |
| Wrong passcode (org-wide) | 50 / hour | Stops address rotation from buying unlimited guesses |
| Kill switch | `DISABLED` secret | |
| Season expiry | 2027-01-15 | Hardcoded |

A request-count cap is **not** a spend cap — a request can cost anywhere from
~1.7¢ to ~9¢. The $3.00 cents counter is the brake that actually binds the
bill, and it leaves the business $7 of headroom under the $10 org cap.

Spend is **reserved before the call, not recorded after it**. Aborting a fetch
does not un-bill Anthropic: a request that times out may still have generated
(and been charged for) its tokens. So the worst case is charged to the counter
up front, and only a clean success gives the difference back — a timeout,
upstream error, refusal or truncation leaves the reservation standing.

Two residual limits, accepted and bounded by the caps above but worth knowing:
the budget is checked *before* each call, so a single request can overshoot by
about one worst-case charge (treat the ceiling as ~$3.09, not $3.00); and the
per-IP hour counter is a fixed window, so an IP can send 2× its limit across an
hour boundary.

## Safety notes

- The passcode is a **speed bump, not a lock** — it lives in teachers' browsers and
  gets shared. Also set a monthly spend limit in the Anthropic console as a second
  backstop. Rotate the passcode with `wrangler secret put TEAM_PASSCODE`.
- Keep students' names and personal details out of anything sent through here.
  The Worker never logs request bodies, and never logs upstream error bodies
  either (Anthropic 4xx bodies can echo the offending field back) — only the
  request id, the HTTP status, and Anthropic's own `request-id` header.
- Everything fails **closed**. A KV outage, a missing binding, or a failed spend
  write returns `503` and makes no Anthropic call. If the helper is down, that is
  working as designed — it is protecting production.
- `GET /healthz` is free (no AI call, no KV) if you want uptime monitoring.
