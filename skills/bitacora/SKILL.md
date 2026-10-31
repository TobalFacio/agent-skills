---
name: bitacora
description: Append one entry to the project's development log for the day — an auditor verdict, a story closing, an architecture decision or a blocker. Runs right after the auditor, always, pass or fail. Append-only, and it never blocks the cycle. Every project-specific value comes from .agents/project.yml.
---

# Bitácora — one append, and nothing else

Takes a fact that just happened in the development cycle and **appends one entry to the day's log
file**. That is the whole job: no judgement, no summary of the code, no rewriting of what is already
there.

---

## Step 0 — Load the configuration. Always. First.

Read **`.agents/project.yml`** from the repo root before anything else.

If `paths.bitacora` is `null` or absent, **this project keeps no log**: say so in one line and return
control. Do not invent a folder.

If the file does not exist at all, **stop** and say:

> This repo has no `.agents/project.yml`. The shared skills read every project-specific value from
> it. Copy `templates/project.yml` from the skills repo, fill it in, and run me again.

What the configuration drives:

| Key | Drives |
|---|---|
| `paths.bitacora` | the folder the entry is appended to |
| `project.name` · `project.repo` | the header written when the day's file is created |
| `project.language.docs` | the language the entry is written in |
| `story.id_prefix` | how a story is named in the entry title |
| `story.gap_marker` | how an open hole is written when the entry records one |

There is one value the configuration does not carry: **the local date and time**. Ask for it, or read
it from the environment. **Never guess it** — a log with a wrong timestamp is worse than no log,
because it silently reorders the day.

---

## Invariants

These four are the skill. Everything else is formatting.

1. **Never rewrite previous content.** Not one comma. If an earlier entry is wrong, **append a new
   entry that corrects it and cites the time of the wrong one**. The log is append-only; that is what
   makes it worth reading months later.
2. **Never fail the cycle.** On any error — locked file, permissions, unexpected format — say so in
   one line and return control. **The log never blocks a merge.** If a verdict exists, it is valid
   whether or not you managed to record it; it gets recorded afterwards.
3. **Never invent.** If a value did not arrive in the input — the sha, the agent's name — write `—`
   and **do not derive it**: do not read it out of git, do not approximate it.
4. **One call = one entry.** Never group two verdicts into one block, even from the same story in the
   same minute.

Two more that come from the method rather than from the file:

- **You do not judge.** The auditor emits the verdict; you record it. Keeping the two apart is
  precisely what lets the log never block: if the auditor fails there is nothing to record, and if
  you fail the verdict still stands.
- **You never close a gap.** If the entry records an open `story.gap_marker`, it stays open. A person
  closes it, with a new entry.

---

## When you are called

| Moment | Mandatory |
|---|---|
| The auditor finishes a review — **every verdict, pass and fail** | Yes |
| A story closes (merged, issue closed) | Yes |
| A product or architecture decision taken outside the cycle | Yes |
| A blocker that stops the work | Yes |
| Anything else | No. **The log does not narrate commits** — that is what git is for. |

---

## The file

```
<paths.bitacora>/YYYY-MM-DD.md
```

One file per day, local date. It is created **with the first entry of the day** — a day with no work
has no file. **Never create empty files.**

When you create it, start with the header:

```markdown
# Bitácora · YYYY-MM-DD

> <project.name> · repo `<project.repo>`

```

Then append entries in ascending chronological order: each new one goes at the end.

---

## The entry

```markdown
## HH:MM · <ID | ARQ | BLOQUEO> · <title, 4 to 8 words>

**Agente:** <name> · **Rama:** `<branch>` · **Commit:** `<short sha>`

<Body: 3 to 10 lines, plain language.>

**Siguiente paso:** <one line: who is next and with what.>

---
```

Second field:

| Prefix | Use |
|---|---|
| `<story.id_prefix>-NN` | anything belonging to a story's cycle |
| `ARQ` | a decision that changes architecture — also requires touching `paths.context` |
| `BLOQUEO` | something stopped the work and does not depend on us |

Body rules:

- **Plain language, in `project.language.docs`.** Written so someone who never opened the code
  understands it. No stack traces, no diffs.
- **Ten lines maximum.** If it needs more it is not a log entry: it is a document, and it belongs in
  the docs folder.
- **Findings go by criterion**, citing the number (`C3`, `C5`), never as loose prose.
- **No secrets.** No connection strings, no tokens, no personal data.
- **No mood adjectives.** "Does not meet C3" is not "it came out wrong again". No irony, no
  congratulation, no narrative.
- **24-hour local time.**

---

## What does not go in the log

| Content | Where it lives |
|---|---|
| The story's content | `paths.backlog` |
| Architecture decisions already closed | `paths.context` |
| The plan and the calendar | wherever `board.source_of_truth` points — the repo, or the board (`board.*`) |
| The detail of each commit | git |

The log **cites** those places; it does not duplicate them.

---

## On delivery

```
Bitácora: <file path> · entry appended at HH:MM
Type: <ID | ARQ | BLOQUEO>
```

Or, if something failed:

```
Bitácora: could not record — <reason, one line>. The cycle continues.
```
