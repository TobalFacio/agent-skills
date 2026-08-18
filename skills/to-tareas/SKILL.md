---
name: to-tareas
description: Turn a backlog story into an execution plan published as issues with native blocking and hierarchy relationships. Also covers non-story work (spike, refactor, chore) and re-slicing a story that turned out too large. Every project-specific value comes from .agents/project.yml.
disable-model-invocation: true
---

# To Tareas — from backlog to execution plan

Moves from **what** to **how**. The product spec lives in the backlog; this skill produces the **build plan** and publishes it as issues on the tracker declared in the configuration.

---

## Step 0 — Load the configuration. Always. First.

Read **`.agents/project.yml`** from the repo root before anything else.

If it does not exist, **stop** and say:

> This repo has no `.agents/project.yml`. The shared skills read every project-specific value from it — repo, backlog paths, milestones, labels, branch and PR policy. Copy `templates/project.yml` from the skills repo, fill it in, and run me again.

What the configuration drives here:

| Key | Drives |
|---|---|
| `project.repo` · `project.default_branch` | where issues are published and how permalinks are built |
| `paths.backlog` · `paths.index` | where the story is read and where its status is written back |
| `paths.context` · `paths.conventions` | what must be read before planning |
| `paths.glossary` | the binding vocabulary — skipped when `null` |
| `paths.erd` · `paths.sql` | the data model to consult when the story touches data |
| `paths.mockups` | the interface reference — skipped when `null` |
| `tracker.milestones` · `tracker.labels` | what Step 1 makes sure exists |
| `tracker.gh_min_version` | the floor below which native relationships do not exist |
| `tracker.branch_pattern` · `tracker.pull_request` | what the parent issue tells the developer to do |
| `enums.status` | the value the story moves to once the plan is published |
| `board.enabled` | whether there is an external mirror to update |

**Everything below is written against those keys.** Nothing in this file names a repository, a milestone or an epic of any particular project.

---

## Governing principle: the vertical slice does NOT go down a level

- **At story level** — each story is a vertical slice, demoable on its own. Already solved in the backlog. **Do not redo it.**
- **At task level** — inside a story, tasks are **steps**, and they are legitimately horizontal (migration → data access → service → endpoint → UI → tests). The criterion changes:

> Every task leaves the branch **building and the tests green**. It need not be demoable on its own; the whole story is.

Splitting a two-day story into vertical slices produces crumbs. Don't.

---

## Invariants

- **Write in `project.language.docs`.** The interface is in `project.language.ui` and its labels are quoted, never translated. The glossary, when the project has one, is binding.
- **Never copy the story body into the issue — link it.** The file in git is the single truth for the spec. Duplicating it creates one more place to diverge.
- **Use the tracker's native relationships, not prose.** Writing "Blocked by #12" in the body does **not** create a relationship. On GitHub that means `--parent`, `--blocked-by` and `--blocking`, which require `gh` ≥ `tracker.gh_min_version`. **Check the version before publishing.** This is the exact defect the predecessor of this skill shipped with.
- **Every task fits in a fresh context window.** That is the right unit when an agent does the work.
- **Publish in dependency order**, blockers first, so issue numbers exist when referenced.
- **No source-file paths or code snippets** in issue bodies. Do reference stable documents by name.
- **Do not publish without approval.** Step 5 is not optional.

---

## Modes

| Mode | Invocation | When |
|---|---|---|
| **Execution** (default) | `/to-tareas <id>` | You are about to implement a backlog story |
| **Non-story** | `/to-tareas spike <desc>` · `refactor <desc>` · `chore <desc>` | Work that is not product and does not belong in the backlog |
| **Re-slice** | `/to-tareas split <id>` | While implementing you find the story does not fit and must be divided |

---

## Step 1 — Bootstrap (idempotent, runs every time)

1. Check the tracker CLI version against `tracker.gh_min_version`. If it is lower, **stop** and say so: without native relationships the plan would publish with dead-text blockers. Suggest the upgrade command for the platform.
2. Ensure every milestone in `tracker.milestones` exists; create the missing ones.
3. Ensure every label in `tracker.labels` exists; create the missing ones. Epic labels are created only for the epics actually used.
4. Do not use native issue **types** unless the repo exposes them — on most platforms they are an organization-level feature. Otherwise the type travels as a label.

---

## EXECUTION mode — `/to-tareas <id>`

### 1. Read

1. `paths.context` — mandatory before any task.
2. `paths.conventions` — the repo's code conventions.
3. `paths.glossary` — binding vocabulary, when the project has one.
4. The story file **in full**: **the acceptance criteria are the contract.**
5. Every story in `depends_on` — what already exists and what you are assuming.
6. `paths.erd`, and `paths.sql` when it is set, if the story touches data.
7. The mockup in `paths.mockups` if the story has an interface.

If the story does not exist in `paths.backlog`, **stop**. Do not invent stories — that is `/to-hu`'s job.

### 2. Explore the code — only if there is any

If the source directories contain code, explore it: reuse existing seams, follow the conventions in `paths.conventions`, and look for **prefactoring** opportunities — *"make the change easy, then make the easy change."* Prefactoring goes **first** in the task order.

If the repo is still empty, **say so and skip prefactoring**: there are no seams to prefer and no debt to pay. Lean on `paths.context`.

### 3. Define the test seams

Sketch where the story gets tested. Prefer existing seams; use the **highest possible**; the fewer the better. Seams decide which acceptance criteria are genuinely verifiable and which task they land in.

### 4. Draft the plan

Cut the story into ordered tasks. For each:

- **Title**, short and imperative.
- **Layer**, from the layer labels in `tracker.labels.layer`.
- **What it leaves working** when done.
- **Blocked by** — which tasks must close first.
- **Criteria** — traceable to the story's. Every functional criterion must land in **some** task; verify none is orphaned.
- **Verification** — the command or test that proves it is done.

Cutting guidance:

- Prefactoring first, if applicable.
- Migrations before the code that uses them.
- The API contract before the client that consumes it.
- Tests for the chosen seam ride along with the task that introduces the behaviour — never a trailing "write the tests" task.
- If a task does not fit in a fresh context window, split it. If two fit together and share a seam, merge them.

### 5. Review with the user before publishing

Present the plan as a numbered list and ask:

- Does the granularity feel right — too coarse, too fine?
- Are the order and the blocking edges correct?
- Anything missing, or tasks to merge or split?

Iterate until approved. **Do not publish without approval.**

### 6. Publish

**a) Parent issue for the story** — title `<id> — <story title>`. Body from the template below: **link, do not copy**. Epic, priority and milestone labels; the phase milestone from `tracker.milestones`.

**b) Story-level dependencies** — for each `depends_on` entry that already has a parent issue, link it with the native blocked-by relationship. If it does not exist yet, report it as pending.

**c) Task sub-issues** — in dependency order, each with its parent and its blockers set natively. Labels: the task type plus its layer.

**d) Repo consistency** — set the story's `status` in its frontmatter **and** in the `paths.index` table to the "ready" value from `enums.status`. If the plan changed dependencies, update the mermaid graph too when `index.mermaid` is true, and keep `depends_on` / `blocks` symmetric across both files.

**e) Board** — only if `board.enabled`. Set the same status there and add the parent issue link. If the board is unreachable, say so rather than failing.

**f) Bitácora** — if `paths.bitacora` is set, add one plain-language line to the day's file: which story was planned and how many tasks it produced.

Do not close or modify parent issues of other stories.

---

## NON-STORY mode — `/to-tareas spike|refactor|chore <description>`

For work that is not product: exploration, technical debt, maintenance. Does **not** create or touch the backlog.

- **spike** — the question to answer and the closing criterion (*"we will know the answer when…"*). Explicit time box. The deliverable is a written decision, normally an addition to `paths.context` or `paths.decision_record`, not production code.
- **chore** — a single task, no sub-issues unless obviously needed.
- **refactor** — if the blast radius is wide, apply **expand–contract** below.

### Wide refactor: expand–contract

A wide refactor is one mechanical change — rename a column, retype a shared symbol — whose **blast radius** fans across the codebase: a single edit breaks hundreds of call sites at once and no task can stay green alone. Don't force it into a slice; sequence it:

1. **Expand** — add the new form **beside** the old. Nothing breaks. One task.
2. **Migrate** — move call sites in batches sized by blast radius (per project, per folder). Each batch is its own task, blocked by the expand. CI stays green batch to batch because the old form still exists.
3. **Contract** — delete the old form once no caller remains. One task, blocked by **every** migrate batch.

If even the batches cannot stay green alone, keep the sequence but let them share an integration branch, and have them all block a final *integrate and verify* task: green is promised only there.

---

## RE-SLICE mode — `/to-tareas split <id>`

When a story turns out larger than estimated. **This changes the backlog**, so it needs explicit approval before writing.

1. Propose the split into new stories, each in full standard format (use `/to-hu` to draft them if needed).
2. **Distribute the original acceptance criteria** across the new stories. None is lost or duplicated — verify it and show the mapping.
3. Assign new consecutive IDs, never a letter suffix on the original.
4. Recompute the estimates; the sum should exceed the original — if it does not, the split probably was not needed.
5. Rewire dependencies: everything that depended on the original must point at the right new story, not at all of them by default.
6. Update the **frontmatter of every affected story**, the phase tables, the mermaid graph and the totals when the config asks for them, and the board.
7. The original story: mark it done with a note that it was split, or remove it from the backlog if it was never worked. **Decide with the user, not alone.**
8. Run `verify.command`. Do not deliver on red.

---

## Templates

<parent-issue>

**Spec:** [`<story file>`](https://github.com/<project.repo>/blob/<project.default_branch>/<paths.backlog>/<story file>) — the acceptance criteria in that file are this story's contract.

| | |
|---|---|
| Epic | \<epic\> |
| Module | \<module\> |
| Phase · Stage | \<phase\> · \<stage\> |
| Priority · Milestone | \<priority\> · \<milestone\> |
| Estimate | \<N\> days |

**Suggested branch:** `<tracker.branch_pattern applied to this story>`
**Pull request:** \<required | recommended | not used, per `tracker.pull_request`\>

**Execution plan:** the sub-issues below, in order. Each leaves the branch building with tests green.

**Done when:** every acceptance criterion in the story holds and all sub-issues are closed.

</parent-issue>

<task-issue>

**Story:** #\<parent issue number\> · **Layer:** \<layer\>

**What it leaves working:** the concrete behaviour that exists once this task is done.

**Criteria** *(traceable to the story)*

- [ ] \<criterion\> — covers story criterion \<n\>
- [ ] \<criterion\>

**Verification:** `<command or test that proves it>`

**Notes:** relevant design decisions, reference document. No code paths, no snippets.

</task-issue>

---

## Self-check before publishing

- [ ] Did I read `.agents/project.yml`, and did I stop instead of guessing when something was missing?
- [ ] Is the tracker CLI at or above `tracker.gh_min_version`?
- [ ] Do the milestones and labels I am about to use exist?
- [ ] Is **no** acceptance criterion left without a task covering it?
- [ ] Does every task leave the branch green — and am I not demanding it be demoable alone?
- [ ] Does every task fit in a fresh context window?
- [ ] Did I publish in dependency order, blockers first?
- [ ] Did I use **real** native parent and blocked-by relationships, not body prose? Confirm by re-reading one issue and inspecting those fields.
- [ ] Does the parent issue **link** the story instead of copying it?
- [ ] Did I set `status` in the frontmatter **and** in the index table?
- [ ] If dependencies changed, did I update the graph and keep `depends_on` / `blocks` symmetric?
- [ ] Does every domain term match the glossary?
- [ ] Did I update the board, or record that I could not?
- [ ] Does `verify.command` come out green?
