# How we keep track of things

Two places, two jobs:

| | Where | Who uses it |
|---|---|---|
| **Tasks** — things with a deadline and a state | [The board](https://github.com/users/mirzaaamerali/projects) — Backlog → In progress → Blocker → Done | Coach + anyone with a GitHub account. **Anyone can view it without one.** |
| **Notes & ideas** — meeting write-ups, suggestions, questions | The **Journal** tab on the team site (a Google Form) | Everyone. No account, no login. |

The Journal is the inbox; the board is the plan. If a note turns out to be a
real task, it becomes a card on the board.

Seeding the board is a one-time job — see [`scripts/seed-board.py`](../scripts/seed-board.py),
which creates 40 issues from the season plan (every paperwork deadline, the hard
gates, and the scrimmage-readiness checklist).

---

# Sharing notes and ideas — for teachers and volunteers

You do **not** need a GitHub account, a login, or any app. There's a Journal tab
on the team site: type your note, hit submit, done. Everything the team has
written shows up underneath it.

**Team site:** https://mirzaaamerali.github.io/barracoder/ → **Journal**

## What to put in it

- What actually happened at a meeting — what got built, what broke, what's next
- Ideas for the robot, the innovation project, or how to run a session
- Questions for the coach
- Things to remember before the scrimmage

**Keep students' personal details out of it.** This page is public on the
internet. First names in the context of the robotics work ("Maya got the color
sensor working") are fine. Addresses, contact details, anything about a child's
health, behaviour, or family — not here. Tell the coach directly instead.

---

# Setting it up (coach — one time, ~10 minutes)

Do this in the **personal** Google account (mirzaaa.com), not the Rooted Reality
one — this is a personal project and its data should live on that side.

## 1. Make the form

[forms.google.com](https://forms.google.com) → blank form. Call it
**Barracoder team journal**. Suggested fields:

| Field | Type | Notes |
|---|---|---|
| Your name | Short answer | Not required — anonymous notes are fine |
| Date this is about | Date | Defaults to today |
| Type | Multiple choice | Meeting note · Idea · Question · Something to remember |
| What happened / what's your idea? | Paragraph | The main field. Mark it required. |

In **Settings**, confirm sign-in is **not** required — otherwise volunteers
without Google accounts get locked out. Under the palette icon, pick a dark
theme colour so the embedded form doesn't glare against the site's dark
background.

## 2. Get the embed URL

**Send** → the `< >` (embed) tab → copy the `src="..."` value out of the iframe
snippet. It looks like:

```
https://docs.google.com/forms/d/e/1FAIpQL.../viewform?embedded=true
```

## 3. (Optional) Show past entries on the site

In the form's **Responses** tab, open the linked Google Sheet. Then in the
Sheet: **File → Share → Publish to web** → choose the responses sheet →
**Embed** → copy that `src="..."`. It looks like:

```
https://docs.google.com/spreadsheets/d/e/2PACX-.../pubhtml?widget=true&headers=false
```

⚠️ Publishing makes that sheet readable by anyone with the link. Only do it if
you're happy for journal entries to be public — which, given they're going on a
public website, they are. Skip this step and the form still works; you just
won't see past entries on the site.

## 4. Paste both into the site

Edit [`assets/collab-config.js`](../assets/collab-config.js) — you can do it
straight from GitHub's web editor with the pencil icon:

```js
window.BARRACODER_COLLAB = {
  formEmbedUrl: 'https://docs.google.com/forms/d/e/.../viewform?embedded=true',
  responsesEmbedUrl: ''   // optional, from step 3
};
```

Commit. A minute later the **Journal** tab appears on the site and a
**📝 Team journal** link shows up on the daily meeting page. Until
`formEmbedUrl` is filled in, neither exists at all.

## 5. Tell the team

Send the site link and say "Journal tab, type, submit." That's the whole
instruction.

---

## Anything worth keeping permanently

Google Forms is for the running chatter. If something deserves to outlive the
season — a build technique, a mission strategy that worked — copy it into
[`notes/`](../notes/) as a markdown file, or ask the coach to. That folder is
part of the repo and gets archived with everything else.
