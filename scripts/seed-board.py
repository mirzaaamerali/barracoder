#!/usr/bin/env python3
"""Seed the Barracoder GitHub Project board from the season plan.

Creates labels, issues, and a Project with Backlog / In progress / Blocker /
Done columns plus a Due date field, then files every issue into it.

Safe to re-run: it skips issues whose title already exists and reuses an
existing project of the same name.

    gh auth login                    # pick the mirzaaamerali account
    gh auth refresh -s project       # Projects needs its own scope
    python3 scripts/seed-board.py            # dry run — prints what it would do
    python3 scripts/seed-board.py --apply    # actually create things
"""

import argparse
import json
import os
import subprocess
import sys

REPO = "mirzaaamerali/barracoder"
OWNER = "mirzaaamerali"
PROJECT_TITLE = "Barracoder season"
SEED = os.path.join(os.path.dirname(os.path.abspath(__file__)), "board-seed.json")

STATUS_OPTIONS = ["Backlog", "In progress", "Blocker", "Done"]

LABELS = [
    ("paperwork", "B08800", "Forms, registrations and deadlines"),
    ("scrimmage", "B0426A", "Getting ready for Sun 8 Nov"),
    ("gate", "1E7A4B", "A hard checkpoint the season depends on"),
    ("robot", "0E7F8C", "Robot, missions, code"),
    ("project", "5F4B9E", "Innovation project"),
]


def gh(args, apply=True, capture=True):
    """Run a gh command. In dry-run mode, print it instead."""
    if not apply:
        print("   would run: gh " + " ".join(args[:6]) + (" …" if len(args) > 6 else ""))
        return ""
    r = subprocess.run(["gh"] + args, capture_output=capture, text=True)
    if r.returncode != 0:
        err = (r.stderr or "").strip()
        raise RuntimeError("gh " + " ".join(args[:4]) + " failed: " + err[:300])
    return (r.stdout or "").strip()


def preflight():
    """Fail early and clearly rather than half-creating a board."""
    try:
        who = subprocess.run(["gh", "api", "user", "--jq", ".login"],
                             capture_output=True, text=True).stdout.strip()
    except FileNotFoundError:
        sys.exit("gh CLI not found. Install it, then `gh auth login`.")
    if who != OWNER:
        sys.exit(
            f"gh is signed in as '{who}', but the repo belongs to '{OWNER}'.\n"
            f"  Fix:  gh auth login        # add the {OWNER} account\n"
            f"        gh auth switch --user {OWNER}\n"
            f"        gh auth refresh -s project"
        )
    scopes = subprocess.run(["gh", "auth", "status"], capture_output=True, text=True)
    blob = (scopes.stdout or "") + (scopes.stderr or "")
    if "project" not in blob:
        sys.exit("The gh token has no 'project' scope.\n  Fix:  gh auth refresh -s project")
    return who


def existing_issue_titles():
    out = gh(["issue", "list", "--repo", REPO, "--state", "all",
              "--limit", "300", "--json", "title"])
    return {i["title"] for i in json.loads(out or "[]")}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="actually create things")
    args = ap.parse_args()
    apply = args.apply

    with open(SEED) as f:
        seed = json.load(f)

    if apply:
        who = preflight()
        print(f"authenticated as {who}\n")
    else:
        print("DRY RUN — nothing will be created. Re-run with --apply.\n")

    # ---- labels -------------------------------------------------------
    print(f"labels ({len(LABELS)})")
    for name, colour, desc in LABELS:
        if apply:
            subprocess.run(["gh", "label", "create", name, "--repo", REPO,
                            "--color", colour, "--description", desc, "--force"],
                           capture_output=True, text=True)
        print(f"   {name}")

    # ---- issues -------------------------------------------------------
    have = existing_issue_titles() if apply else set()
    made, skipped = [], 0
    print(f"\nissues ({len(seed['issues'])})")
    for it in seed["issues"]:
        if it["title"] in have:
            skipped += 1
            continue
        body = it["body"]
        if it.get("due"):
            body += f"\n\n**Due: {it['due']}**"
        body += "\n\n<sub>Seeded from the season plan — see SCHEDULE.md</sub>"
        if apply:
            url = gh(["issue", "create", "--repo", REPO, "--title", it["title"],
                      "--body", body, "--label", ",".join(it["labels"])])
            made.append((url, it))
            print(f"   + {it['title'][:68]}")
        else:
            print(f"   + [{','.join(it['labels'])}] {it['title'][:60]}"
                  + (f"  (due {it['due']})" if it.get("due") else ""))
    if skipped:
        print(f"   ({skipped} already existed — skipped)")

    # ---- project ------------------------------------------------------
    print(f"\nproject '{PROJECT_TITLE}'")
    print(f"   columns: {' / '.join(STATUS_OPTIONS)}")
    print("   fields : Status, Due date, Phase")
    if not apply:
        print("\nDry run complete. Re-run with --apply to create all of the above.")
        return

    out = gh(["project", "list", "--owner", OWNER, "--format", "json"])
    projects = json.loads(out).get("projects", [])
    match = next((p for p in projects if p["title"] == PROJECT_TITLE), None)
    if match:
        number = str(match["number"])
        print(f"   reusing existing project #{number}")
    else:
        out = gh(["project", "create", "--owner", OWNER,
                  "--title", PROJECT_TITLE, "--format", "json"])
        number = str(json.loads(out)["number"])
        print(f"   created project #{number}")

    # A Date field for the roadmap view. Status already exists by default with
    # Todo/In Progress/Done; renaming its options via the CLI is not supported,
    # so adjust those four names once in the UI (30 seconds) if you want the
    # exact Backlog/In progress/Blocker/Done set.
    try:
        gh(["project", "field-create", number, "--owner", OWNER,
            "--name", "Due date", "--data-type", "DATE"])
        print("   added field: Due date")
    except RuntimeError:
        print("   field 'Due date' already present")

    print(f"\nadding {len(made)} issues to the project")
    for url, it in made:
        try:
            gh(["project", "item-add", number, "--owner", OWNER, "--url", url])
        except RuntimeError as e:
            print(f"   ! {it['title'][:50]}: {e}")
    print(f"\nDone. Board: https://github.com/users/{OWNER}/projects/{number}")
    print("Set the Status options to Backlog / In progress / Blocker / Done in the UI,")
    print("then add a Roadmap view grouped by Status and dated by 'Due date'.")


if __name__ == "__main__":
    main()
