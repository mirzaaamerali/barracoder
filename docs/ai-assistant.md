# The team-site assistant — what it is, and the rules

The team site has an optional AI helper. It can draft a parent recap of a meeting,
tidy a rough journal note into a clean entry, and answer questions about the season
plan. It is a convenience, not a system of record — **everything it writes is a
draft that a human reads before it goes anywhere.**

## How it works

The website is public and static, so it cannot hold a secret. Instead the page talks
to a small Cloudflare Worker ([worker/](../worker/)) which holds the API key and
calls Claude. The Worker only accepts three specific tasks with structured input —
it will not run a free-form prompt, so finding the URL doesn't get anyone a free
chatbot.

Using it needs the **team passcode**. Ask the coach. Treat it like the door code to
the meeting room: it keeps strangers out, it is not a secret worth defending.

## What you must not type into it

Text you submit is sent to Anthropic's API, where it may be retained for around
30 days, and it is billed to a private account. There is no school data agreement
covering it.

So keep it to the robotics work:

- ✅ "Built M01 and M03, ran out of time on the lift, kids want to redo the gripper"
- ❌ Children's full names, ages, addresses, contact details, photos
- ❌ Anything about a child's health, behaviour, family, or performance
- ❌ Anything you wouldn't be comfortable seeing forwarded

First names in the context of the robot work ("Maya coded the color sensor") are
fine. Anything that would identify a child to a stranger, or characterize them, is
not.

## Read before you send

The recap is a **draft**. Models can state something confidently that never
happened — a mission that wasn't attempted, a contribution credited to the wrong
kid. Read every word before it reaches a parent's inbox.

## Cost and switching it off

Requests are capped — per person per hour, per day, and per month — so an accident
can't run up a bill. If something looks wrong, it can be switched off instantly:

```sh
cd worker && npx wrangler secret put DISABLED   # type any value, e.g. 1
```

Turn it back on with `npx wrangler secret delete DISABLED`.

## End of season

The helper retires automatically after **15 Jan 2027** — it will politely refuse
rather than sit on the internet unattended. When the season wraps, also:

- [ ] Delete the Worker (`npx wrangler delete`)
- [ ] Revoke the API key in the Anthropic console
- [ ] Clear `window.BARRACODER_AI_ENDPOINT` in `assets/ai-config.js`
