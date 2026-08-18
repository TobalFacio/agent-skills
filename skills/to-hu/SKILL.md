---
name: to-hu
description: Turn the current conversation into one or more user stories in the project's story standard, written to the backlog folder and optionally mirrored to an external board. No interview — synthesis of what has already been discussed. Every project-specific value comes from .agents/project.yml.
disable-model-invocation: true
---

# To HU — user story in the project's standard

Takes the current conversation and codebase understanding and produces **user stories conforming to this project's story standard**, written to the backlog folder declared in the configuration.

**Do not interview the user.** Synthesize what you already know. When a mandatory field is not supported by the conversation, **infer it from project context and mark it with `story.inferred_marker`** — never leave it blank, never invent it silently.

---

## Step 0 — Load the configuration. Always. First.

Read **`.agents/project.yml`** from the repo root before anything else.

If it does not exist, **stop** and say:

> This repo has no `.agents/project.yml`. The shared skills read every project-specific value from it — backlog paths, section headings, allowed enum values, repo, board. Copy `templates/project.yml` from the skills repo, fill it in, and run me again.

Do not guess the missing values from folder names. A wrong guess writes a story into the wrong place with the wrong headings, and the error surfaces days later.

What the configuration drives:

| Key | Drives |
|---|---|
| `paths.backlog` · `paths.index` | where the story file and its index row are written |
| `paths.context` · `paths.decision_record` | what must be read before writing |
| `paths.glossary` | the binding vocabulary — skipped when `null` |
| `paths.template` | the exact skeleton to copy |
| `paths.erd` · `paths.sql` | the authoritative data model, for §6.2 |
| `paths.mockups` | where to look for an interface — skipped when `null` |
| `story.sections` | the mandatory headings, in order, in the project's language |
| `story.actor_markers` | how the single actor sentence is written |
| `story.gap_marker` · `story.inferred_marker` | how holes and inferences are flagged |
| `story.frontmatter` | required, optional and forbidden keys |
| `enums.*` | the closed sets for `status`, `phase`, `stage`, `priority`, `module`, `milestone`, `epic` |
| `index.mermaid` · `index.totals` · `index.subtotal` | which index artifacts must be updated |
| `board.enabled` | whether there is an external mirror to update |
| `verify.command` | the judge that has to come out green |
| `project.language.docs` · `project.language.ui` | the language you write in, and the language you must not translate |

**Everything below is written against those keys.** Where this document says *the backlog*, it means `paths.backlog`. Nothing in this file names a folder, an epic, a phase or a repository of any particular project.

---

## Invariants

- **Write the documentation in `project.language.docs`.** The interface is in `project.language.ui`; **do not translate on-screen labels** when describing mockups — quote them as they appear.
- **The glossary is binding when there is one.** If `paths.glossary` is set, every domain term must use the form in that table and every identifier must match its code column. If a term is missing, add it to the glossary before using it. Loanwords declared untranslatable in the glossary stay untranslated. If `paths.glossary` is `null`, use the terms already present in `paths.context` and be consistent with yourself.
- **One story = one file.** The description section carries **exactly one** actor sentence, using one of `story.actor_markers`. If the conversation spans more, produce **several stories** and declare their dependencies. Never a long list of stories inside one document.
- **All the headings in `story.sections` are mandatory**, with their numbering, in that order. If one does not apply, write `— Not applicable (reason)` in the documentation language. Never delete a heading.
- **The data section is mandatory in every story, with no exception.** List the tables the story reads and writes, plus any column, index, constraint, function or seed it creates or modifies, schema-qualified, with the migration number. If it touches nothing at all, say so explicitly.

  A story that needs a column which does not exist must say so **there**, before it is estimated, in exactly this form so the whole backlog can be grepped with it:

  `- <story.gap_marker> — <what the criterion needs>. <Where it must land>.`

  This is not bookkeeping. The pattern this skill came from lost sixteen schema gaps to stories that had skipped this section; every one of them surfaced only when a developer already had the ticket open. The section is mandatory **even when the answer is "nothing"**, because a heading followed by silence is indistinguishable from a heading nobody filled.
- **No source-file paths or code snippets** in the story — they age badly and the story outlives them. **Exception:** design artifacts (`paths.mockups`) and stable documents are referenced **by name**.
- **Nothing is published on red.** `verify.command` is the judge.

---

## Process

### 1. Read before writing

Mandatory on every run, in this order, skipping what the configuration declares as `null`:

1. `paths.context` — architecture, data model, conventions, API, annexes.
2. `paths.decision_record` — the closed decisions. **A story that contradicts a closed decision is wrong, not innovative.** If the project declares none, say so on delivery: it means nothing protects you from reopening a settled argument.
3. `paths.glossary` — the binding vocabulary.
4. `paths.index` — the next free ID, related stories, the phase and epic values actually in use.
5. Every story listed in `depends_on` — to know what already exists and what you are assuming.
6. The mockup in `paths.mockups`, if the story has an interface.
7. `paths.erd`, and `paths.sql` if it is set — when both exist, **`paths.sql` wins**: it is the DDL that actually runs.

If anything in the conversation **contradicts** the context or the data model, do not resolve it yourself: write the story following the context and **report the discrepancy on delivery**.

### 2. Define the test seams

Sketch the seam at which the feature will be tested. Prefer existing seams. Use the **highest seam possible** — the fewer new seams, the better; ideally one.

Confirm with the user that these seams match their expectations. Seams determine which acceptance criteria are genuinely verifiable.

### 3. Write the story

Copy `paths.template` **verbatim** and fill it. Frontmatter carries exactly the keys in `story.frontmatter.required`, plus any of `story.frontmatter.optional` that apply, and **none** of `story.frontmatter.forbidden`.

Every enum field takes its value from the matching set in `enums`. If the value the story needs is not in the set, **stop and ask** — do not extend the set on your own. An enum that grows silently stops being a check.

File name: `<story.id_prefix>-<NN>-<slug>.md` in `paths.backlog`, slug in `story.slug_language`. The prefix is kept as a stable opaque identifier even when it no longer stands for anything.

### 4. Publish

**a) File** — write it into `paths.backlog`.

**b) Index** — add the story to its phase table in `paths.index`. If `index.totals` is true, update the day totals and the subtotal row declared in `index.subtotal`. If `index.mermaid` is true, **regenerate** the dependency graph from `depends_on` rather than hand-editing it — a graph that disagrees with the stories is worse than no graph, because planning gets read off the picture.

**c) Reciprocity** — if the story declares `depends_on: [X]`, then `X` must gain this story in its `blocks`. Update both files. The pair must be symmetric.

**d) Board** — only if `board.enabled` is true. Create or update the page and set its properties into `board.data_source`. If the board models dependencies as a two-way synced relation, set only one side. If the board is unreachable, **say so on delivery rather than failing** — `board.source_of_truth` says which side wins, and it is normally the repo.

**e) Verify** — run `verify.command` from the repo root. **It is the judge: if it fails, the story is wrong, not the script.** Do not deliver on red.

### 5. Update the context

If the story introduces architecture decisions, tables, endpoints or events, **propose** the matching addition to `paths.context` (and to `paths.decision_record` if the project keeps one separately). Do not write it without confirmation.

### 6. Close the loop

Tell the user they can run `/to-tareas <id>` to break the story into an execution plan published as issues.

If `paths.bitacora` is set, note in the day's entry that the story was created — one line, plain language.

---

## Self-check before publishing

- [ ] Did I read `.agents/project.yml`, and did I stop instead of guessing when something was missing?
- [ ] Is there **exactly one** actor sentence, matching one of `story.actor_markers`?
- [ ] Are **all** the headings in `story.sections` present, with their numbering, including the data section?
- [ ] Is every field populated, with anything unsupported by the conversation marked with `story.inferred_marker`?
- [ ] Does every domain term match the glossary, and are untranslatable loanwords left alone?
- [ ] Are the functional criteria **verifiable** — do they state the expected result rather than an intention?
- [ ] Do events follow the naming already in use, consistent with the existing ones?
- [ ] Do endpoints carry a verb, the API prefix in use, and the new/modified marker?
- [ ] Do `depends_on` and `blocks` point at stories that **exist**, and is the pairing symmetric?
- [ ] Do all enum fields take values from `enums`, without me having extended any set?
- [ ] Did I update the phase table — and the totals and the mermaid graph, if the config asks for them?
- [ ] Is the content consistent with `paths.context`, the decision record and the authoritative data model?
- [ ] Does the data section list every table, column and migration the story needs — **including the ones that do not exist yet**, each on its own `story.gap_marker` line?
- [ ] Does `verify.command` come out **green**?
