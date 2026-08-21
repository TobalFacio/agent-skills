#!/usr/bin/env node
/**
 * Verify the integrity of the backlog against the rules declared in .agents/project.yml.
 *
 *     node scripts/verify-backlog.mjs            # from anywhere inside the repo
 *     node scripts/verify-backlog.mjs --quiet    # only failures
 *     node scripts/verify-backlog.mjs --config path/to/project.yml
 *
 * Exits 0 if every enabled check passes, 1 otherwise. **No dependencies** — this runs in
 * repos that have Node for other reasons, and adds nothing to install.
 *
 * This is the generic descendant of a project-specific verifier. Everything that used to
 * be a constant in the source — paths, section headings, enum values, the index row
 * shape, whether there is a mermaid graph at all — now comes from the configuration.
 * The checks themselves, and the reasons they exist, did not change:
 *
 *   ids           ids unique, and the filename's number matches the id inside
 *   references    depends_on / blocks point at stories that exist
 *   symmetry      depends_on / blocks agree in both directions
 *   phase_order   no story depends on one in a later phase
 *   frontmatter   required keys present, forbidden keys absent, estimate is a number
 *   enums         enum values come from the declared sets
 *   sections      every story carries the standard's headings
 *   single_actor  exactly one actor sentence per story
 *   data_section  the data section says something, and gaps are flagged the agreed way
 *   index_rows    the index agrees with the frontmatter
 *   index_totals  the index totals equal the computed ones
 *   mermaid       the graph declares every story and its edges ARE depends_on
 *   diagrams      diagrams cite stories that exist, with the phase they really have
 *
 * Why the data-section check exists, in case someone is tempted to soften it: the audit
 * that produced this script found 60 of 70 stories with no data section at all. That
 * single hole is what let acceptance criteria promise columns nobody had modelled — a
 * story could pass review, reach a developer, and only then turn out to need a table
 * that does not exist. So the section is mandatory even when the answer is "nothing",
 * and a gap has to be written in the agreed form rather than left silent.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve, sep } from "node:path";

// =====================================================================  YAML subset
// A deliberately small parser: nested maps, block lists, inline scalar lists, quoted
// strings, comments, null/true/false/numbers. That is the whole grammar project.yml
// is allowed to use — anything fancier belongs in code, not in configuration.
function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function scalar(raw) {
  const v = raw.trim();
  if (v === "" ) return null;
  if (v === "null" || v === "~") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  // Double quotes process escapes (so a regex can be written "^E\\d{2}$"); single quotes
  // are literal except for the doubled '' — same as YAML proper.
  if (v.startsWith('"') && v.endsWith('"') && v.length > 1)
    return v.slice(1, -1).replace(/\\(["\\/])/g, "$1").replace(/\\n/g, "\n").replace(/\\t/g, "\t");
  if (v.startsWith("'") && v.endsWith("'") && v.length > 1)
    return v.slice(1, -1).replace(/''/g, "'");
  if (v.startsWith("[") && v.endsWith("]"))
    return v.slice(1, -1).split(",").map(s => scalar(s)).filter(s => s !== null);
  return v;
}

function parseYaml(text) {
  const lines = [];
  for (const raw of text.split(/\r?\n/)) {
    const noComment = stripComment(raw);
    if (!noComment.trim()) continue;
    lines.push({ indent: noComment.match(/^ */)[0].length, text: noComment.trim() });
  }
  let i = 0;
  function block(indent) {
    if (i >= lines.length) return null;
    if (lines[i].text.startsWith("- ")) {
      const out = [];
      while (i < lines.length && lines[i].indent === indent && lines[i].text.startsWith("- ")) {
        out.push(scalar(lines[i].text.slice(2)));
        i++;
      }
      return out;
    }
    const out = {};
    while (i < lines.length && lines[i].indent === indent) {
      const m = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(lines[i].text);
      if (!m) { i++; continue; }
      const [, key, rest] = m;
      i++;
      if (rest.trim() !== "") { out[key] = scalar(rest); continue; }
      if (i < lines.length && lines[i].indent > indent) out[key] = block(lines[i].indent);
      else out[key] = null;
    }
    return out;
  }
  return block(lines.length ? lines[0].indent : 0) ?? {};
}

// =====================================================================  config
const argv = process.argv.slice(2);
const QUIET = argv.includes("--quiet");
const cfgFlag = argv.indexOf("--config");

function findRoot(from) {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, ".agents", "project.yml"))) return dir;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

let ROOT, CONFIG_PATH;
if (cfgFlag !== -1 && argv[cfgFlag + 1]) {
  CONFIG_PATH = resolve(argv[cfgFlag + 1]);
  ROOT = dirname(dirname(CONFIG_PATH));
} else {
  ROOT = findRoot(process.cwd());
  if (!ROOT) {
    console.error(
      "No .agents/project.yml found from here upward.\n" +
      "The shared skills and this verifier read every project-specific value from it.\n" +
      "Copy templates/project.yml from the skills repo into .agents/project.yml and fill it in."
    );
    process.exit(1);
  }
  CONFIG_PATH = join(ROOT, ".agents", "project.yml");
}

const cfg = parseYaml(readFileSync(CONFIG_PATH, "utf8"));

const failures = [];
const fail = (check, msg) => failures.push({ check, msg });
const ok = (msg) => { if (!QUIET) console.log(`  ok    ${msg}`); };
// Only claim a check passed when nothing in its family has failed. Announcing "ok"
// above a FAIL for the same rule is how a green line ends up quoted as proof.
const okIf = (families, msg) => { if (!failures.some(f => families.includes(f.check))) ok(msg); };
const cfgFail = (msg) => { console.error(`Configuration problem in ${CONFIG_PATH}:\n  ${msg}`); process.exit(1); };

const need = (path) => {
  const v = path.split(".").reduce((o, k) => (o == null ? o : o[k]), cfg);
  if (v === undefined || v === null || v === "") cfgFail(`'${path}' is required and is missing.`);
  return v;
};
const opt = (path, dflt = null) => {
  const v = path.split(".").reduce((o, k) => (o == null ? o : o[k]), cfg);
  return v === undefined || v === null ? dflt : v;
};

const CHECK = (name, dflt = true) => {
  const v = opt(`verify.checks.${name}`);
  return v === null ? dflt : Boolean(v);
};

const BACKLOG_REL = need("paths.backlog");
const BACKLOG = join(ROOT, ...BACKLOG_REL.split("/"));
const INDEX_REL = need("paths.index");
const INDEX = join(ROOT, ...INDEX_REL.split("/"));

const PREFIX = opt("story.id_prefix", "HU");
// Ancho del relleno con ceros del número de historia. NO es una clave de configuración: se
// deduce de los propios nombres de archivo del backlog, más abajo, en cuanto se leen. El 2 es
// sólo la red por si el directorio viniera vacío.
let PAD = 2;
const REQUIRED_KEYS = opt("story.frontmatter.required", []);
const OPTIONAL_KEYS = opt("story.frontmatter.optional", []);
const FORBIDDEN_KEYS = opt("story.frontmatter.forbidden", []);
const SECTIONS = opt("story.sections", []);
const ACTOR_MARKERS = opt("story.actor_markers", []);
const DATA_SECTION = opt("story.data_section", null);
const GAP_MARKER = opt("story.gap_marker", "⚠️ MISSING");
const ESTIMATE_RE = new RegExp(opt("story.estimate_pattern", "^\\d+$"));

const PHASES = opt("enums.phase", []);
const ALLOWED = {};
for (const key of ["status", "phase", "stage", "priority", "module", "milestone"]) {
  const set = opt(`enums.${key}`);
  if (Array.isArray(set) && set.length) ALLOWED[key] = new Set(set);
}
const EPIC_RE = opt("enums.epic_pattern") ? new RegExp(opt("enums.epic_pattern")) : null;

if (!REQUIRED_KEYS.length) cfgFail("'story.frontmatter.required' must list at least the id key.");
if (CHECK("sections") && !SECTIONS.length) cfgFail("'story.sections' is empty but verify.checks.sections is on.");
if (CHECK("single_actor") && !ACTOR_MARKERS.length) cfgFail("'story.actor_markers' is empty but verify.checks.single_actor is on.");

// =====================================================================  helpers
function frontmatter(text) {
  const data = {};
  if (!text.startsWith("---")) return data;
  const block = text.split("---")[1] ?? "";
  for (const line of block.split(/\r?\n/)) {
    const m = /^(\w+):\s*(.*)$/.exec(line);
    if (m) data[m[1]] = m[2].trim();
  }
  return data;
}
const asList = (v = "[]") =>
  String(v ?? "").trim().replace(/^\[|\]$/g, "").split(",")
    .map(s => s.trim().replace(/^["']|["']$/g, "").trim())
    .filter(Boolean);
const countOccurrences = (haystack, needle) => haystack.split(needle).length - 1;
const numOf = (id) => parseInt(String(id).replace(`${PREFIX}-`, ""), 10);
// `canonical` normaliza para COMPARAR: HU-1 y HU-01 tienen que ser la misma historia. Antes
// normalizaba quitando el cero, y esa forma —"HU-1"— se convertía en la llave del Map, o sea en
// lo que salía impreso en TODOS los mensajes de error: un identificador que no existe en ningún
// archivo del repo. Normaliza igual de bien hacia la forma rellenada, que además es la que la
// gente escribe. Misma semántica de comparación, mensajes ciertos.
const padded = (id) => String(numOf(id)).padStart(PAD, "0");
const canonical = (id) => `${PREFIX}-${padded(id)}`;
// El id de nodo de mermaid no lleva el guion — un '-' inicial rompe la sintaxis del grafo.
const nodeOf = (id) => `${PREFIX}${padded(id)}`;
const phaseIndex = (p) => PHASES.indexOf(p);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// =====================================================================  load
const fileRe = new RegExp(`^${escapeRe(PREFIX)}-(\\d+)-.*\\.md$`);
const stories = new Map();
let files;
try {
  files = readdirSync(BACKLOG).filter(f => fileRe.test(f)).sort();
} catch {
  console.error(`Cannot read ${BACKLOG_REL} — is 'paths.backlog' right?`);
  process.exit(1);
}
// El ancho del relleno lo manda el backlog, no una suposición: HU-01-….md → 2, HU-1-….md → 1.
// Se fija ANTES de la primera llamada a canonical(), que es la línea de abajo.
if (files.length)
  PAD = Math.max(...files.map(f => fileRe.exec(f)[1].length));

for (const file of files) {
  const text = readFileSync(join(BACKLOG, file), "utf8");
  const fm = frontmatter(text);
  if (!fm.id) { fail("frontmatter", `${file}: no id`); continue; }
  const id = canonical(fm.id);
  if (stories.has(id)) {
    fail("ids", `duplicate id ${id}: ${file} and ${stories.get(id).file}`);
    continue;
  }
  const m = fileRe.exec(file);
  if (canonical(`${PREFIX}-${m[1]}`) !== id)
    fail("naming", `${file}: filename says ${canonical(`${PREFIX}-${m[1]}`)} but id is ${fm.id}`);
  stories.set(id, { file, fm, text });
}
if (stories.size === 0) {
  console.error(`No stories found in ${BACKLOG_REL}.`);
  process.exit(1);
}

const ids = [...stories.keys()];
const deps = new Map(ids.map(i => [i, asList(stories.get(i).fm.depends_on).map(canonical)]));
const blocks = new Map(ids.map(i => [i, asList(stories.get(i).fm.blocks).map(canonical)]));

console.log(`${opt("project.name", "Backlog")}: ${stories.size} stories in ${BACKLOG_REL}\n`);

// =====================================================  references and symmetry
if (CHECK("references") || CHECK("symmetry")) {
  for (const i of ids) {
    for (const b of deps.get(i)) {
      if (!stories.has(b)) { if (CHECK("references")) fail("references", `${i} depends_on ${b}, which does not exist`); }
      else if (CHECK("symmetry") && !blocks.get(b).includes(i))
        fail("symmetry", `${i} depends_on ${b}, but ${b} does not list ${i} in blocks`);
    }
    for (const b of blocks.get(i)) {
      if (!stories.has(b)) { if (CHECK("references")) fail("references", `${i} blocks ${b}, which does not exist`); }
      else if (CHECK("symmetry") && !deps.get(b).includes(i))
        fail("symmetry", `${i} blocks ${b}, but ${b} does not list ${i} in depends_on`);
    }
  }
  okIf(["references", "symmetry", "ids", "naming"], "references resolve and depends_on/blocks are symmetric");
}

// -------------------------------------------------------------- phase order
if (CHECK("phase_order") && PHASES.length) {
  for (const i of ids) {
    const here = phaseIndex(stories.get(i).fm.phase);
    if (here === -1) continue;
    for (const b of deps.get(i)) {
      if (!stories.has(b)) continue;
      const there = phaseIndex(stories.get(b).fm.phase);
      if (there > here)
        fail("phases", `${i} (${stories.get(i).fm.phase}) depends on ${b} (${stories.get(b).fm.phase}) — later phase`);
    }
  }
  okIf(["phases"], "no story depends on one from a later phase");
}

// ------------------------------------------------------- frontmatter / enums
if (CHECK("frontmatter") || CHECK("enums")) {
  const known = new Set([...REQUIRED_KEYS, ...OPTIONAL_KEYS]);
  for (const i of ids) {
    const { file, fm } = stories.get(i);
    if (CHECK("frontmatter")) {
      for (const key of REQUIRED_KEYS)
        if (!(key in fm)) fail("frontmatter", `${file}: missing key '${key}'`);
      for (const key of FORBIDDEN_KEYS)
        if (key in fm)
          fail("frontmatter", `${file}: '${key}' was removed from the template — drop it, or reinstate it in story.frontmatter.required with a real value`);
      if (CHECK("unknown_keys", false))
        for (const key of Object.keys(fm))
          if (!known.has(key) && !FORBIDDEN_KEYS.includes(key))
            fail("frontmatter", `${file}: unexpected key '${key}' — add it to story.frontmatter.optional or remove it`);
      if ("estimate_days" in fm && !ESTIMATE_RE.test(fm.estimate_days ?? ""))
        fail("frontmatter", `${file}: estimate_days does not match ${ESTIMATE_RE}`);
    }
    if (CHECK("enums")) {
      for (const [key, allowed] of Object.entries(ALLOWED))
        if (key in fm && fm[key] !== "" && !allowed.has(fm[key]))
          fail("enums", `${file}: ${key} = "${fm[key]}" is not an allowed value`);
      if (EPIC_RE && "epic" in fm && !EPIC_RE.test(fm.epic.split(" ")[0]))
        fail("enums", `${file}: epic "${fm.epic}" does not match ${EPIC_RE}`);
    }
  }
  okIf(["frontmatter", "enums"], "frontmatter keys present and enum values valid");
}

// ----------------------------------------------------- sections / one actor
if (CHECK("sections") || CHECK("single_actor")) {
  for (const i of ids) {
    const { file, text } = stories.get(i);
    if (CHECK("sections")) {
      const missing = SECTIONS.filter(s => !text.includes(s));
      if (missing.length) fail("std", `${file}: missing section(s) ${missing.join(", ")}`);
    }
    if (CHECK("single_actor")) {
      const n = ACTOR_MARKERS.reduce((a, mk) => a + countOccurrences(text, mk), 0);
      if (n !== 1) fail("std", `${file}: has ${n} actor sentences, the standard requires exactly 1`);
    }
  }
  okIf(["std"], `every story has the ${SECTIONS.length} standard sections and exactly one actor sentence`);
}

// ------------------------------------------------------------ data section
// Present is not the same as filled. A heading followed by nothing is the hole the
// audit found, wearing a heading.
if (CHECK("data_section") && DATA_SECTION) {
  const markerWord = GAP_MARKER.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const detect = new RegExp(escapeRe(markerWord), "u");
  const wellFormed = new RegExp(`^[-*]\\s*${escapeRe(GAP_MARKER)}\\s+—\\s+\\S`, "u");
  let withGaps = 0, totalGaps = 0;
  for (const i of ids) {
    const { file, text } = stories.get(i);
    const at = text.indexOf(DATA_SECTION);
    if (at === -1) continue;                       // already reported by the sections check
    const rest = text.slice(at + DATA_SECTION.length);
    const nextHeading = rest.search(/^#{1,4} /m);
    const body = (nextHeading === -1 ? rest : rest.slice(0, nextHeading))
      .replace(/^\s*\*\(.*?\)\*\s*$/gm, "")        // drop a template hint line
      .trim();

    if (body.length < 20)
      fail("data", `${file}: the data section is empty — say which tables it reads and writes, or say explicitly that it touches nothing`);

    const gaps = body.split(/\r?\n/).filter(l => detect.test(l));
    for (const line of gaps)
      if (!wellFormed.test(line.trim()))
        fail("data", `${file}: malformed gap line, expected "- ${GAP_MARKER} — <what is needed>": ${line.trim().slice(0, 70)}`);
    if (gaps.length) { withGaps++; totalGaps += gaps.length; }
  }
  // Deliberately NOT checked: that every schema.table named here exists in the DDL. A
  // first attempt did, and drowned in false positives — the section also names event
  // types, setup keys and tables that are meant not to exist yet. Telling those apart
  // needs the DDL parsed, not a regex. Until then that job belongs to the gap line,
  // which is written by whoever knows the difference.
  okIf(["data"], `data section filled in every story · ${totalGaps} declared gap(s) across ${withGaps} story(ies)`);
}

// ------------------------------------------------------------------- index
let readme = null;
try { readme = readFileSync(INDEX, "utf8"); }
catch { fail("index", `cannot read ${INDEX_REL} — is 'paths.index' right?`); }

const days = {}, count = {};
for (const i of ids) {
  const p = stories.get(i).fm.phase ?? "—";
  days[p] = (days[p] ?? 0) + Number(stories.get(i).fm.estimate_days ?? 0);
  count[p] = (count[p] ?? 0) + 1;
}
const totalDays = Object.values(days).reduce((a, b) => a + b, 0);
const totalCount = stories.size;

if (readme && CHECK("index_rows")) {
  const pattern = opt("index.row_pattern");
  if (!pattern) cfgFail("'index.row_pattern' is required when verify.checks.index_rows is on.");
  const rowRe = new RegExp(pattern, "g");
  const seen = new Set();
  for (const m of readme.matchAll(rowRe)) {
    const g = m.groups ?? {};
    if (!g.id) cfgFail("'index.row_pattern' must define at least a named group (?<id>…).");
    const i = canonical(g.id);
    seen.add(i);
    if (!stories.has(i)) { fail("index", `the index lists ${i}, which has no file`); continue; }
    const { file, fm } = stories.get(i);
    if (g.file && g.file !== file) fail("index", `${i}: the index links ${g.file}, file is ${file}`);
    if (g.days !== undefined && Number(g.days) !== Number(fm.estimate_days))
      fail("index", `${i}: the index says ${g.days} days, frontmatter says ${fm.estimate_days}`);
    if (g.status !== undefined && g.status.trim() !== fm.status)
      fail("index", `${i}: the index status "${g.status.trim()}" != frontmatter "${fm.status}"`);
    if (g.epic !== undefined && !String(fm.epic).startsWith(g.epic))
      fail("index", `${i}: the index epic ${g.epic} != frontmatter "${fm.epic}"`);
    if (g.priority !== undefined && g.priority.trim() !== fm.priority)
      fail("index", `${i}: the index priority "${g.priority.trim()}" != frontmatter "${fm.priority}"`);
  }
  for (const i of ids)
    if (!seen.has(i)) fail("index", `${i} has a file but is not in any index phase table`);
  okIf(["index"], "index rows agree with the frontmatter");
}

if (readme && CHECK("index_totals", false)) {
  const boldRow = (label) => {
    const line = readme.split(/\r?\n/).find(l => new RegExp(`^\\|\\s*\\*\\*${escapeRe(label)}\\*\\*`).test(l.trim()));
    if (!line) return null;
    const nums = [...line.matchAll(/\*\*(\d+)\*\*/g)].map(m => Number(m[1]));
    return nums.length >= 2 ? nums.slice(-2) : null;
  };
  const totalLabel = opt("index.total_label", "Total");
  const t = boldRow(totalLabel);
  if (!t) fail("index", `the index has no **${totalLabel}** row with two bold numbers`);
  else {
    if (t[0] !== totalCount) fail("index", `the index total says ${t[0]} stories, computed ${totalCount}`);
    if (t[1] !== totalDays) fail("index", `the index total says ${t[1]} days, computed ${totalDays}`);
  }
  const sub = opt("index.subtotal");
  if (sub && sub.label) {
    const phases = Array.isArray(sub.phases) ? sub.phases : [];
    const sc = phases.reduce((a, p) => a + (count[p] ?? 0), 0);
    const sd = phases.reduce((a, p) => a + (days[p] ?? 0), 0);
    const s = boldRow(sub.label);
    if (!s) fail("index", `the index has no **${sub.label}** subtotal row with two bold numbers`);
    else if (s[0] !== sc || s[1] !== sd)
      fail("index", `the index ${sub.label} row says ${s[0]}/${s[1]}, computed ${sc}/${sd}`);
  }
  okIf(["index"], `index totals match: ${totalCount} stories / ${totalDays} days`);
}

// ------------------------------------------------------------------ mermaid
if (readme && CHECK("mermaid", false)) {
  if (!readme.includes("```mermaid")) {
    // El interruptor es `verify.checks.mermaid`. `index.mermaid` es una clave que se declara en
    // las tres configuraciones y que este script NO lee nunca: nombrarla aquí mandaba a quien
    // leyera el error a apagar la clave equivocada.
    fail("graph", "verify.checks.mermaid is on but the index has no mermaid block");
  } else {
    const graph = readme.split("```mermaid")[1].split("```")[0];
    const nodeRe = new RegExp(`^ {4}(${escapeRe(PREFIX)}\\d+)\\[`, "gm");
    const anyNode = new RegExp(`${escapeRe(PREFIX)}\\d+`, "g");
    const nodes = new Set([...graph.matchAll(nodeRe)].map(m => m[1]));
    const edgeIds = new Set();
    const edgeLineRe = new RegExp(`^ {4}(${escapeRe(PREFIX)}\\d+(?:\\s*(?:-->|==>|\\.->)[^\\n]*?${escapeRe(PREFIX)}\\d+)+)\\s*$`, "gm");
    for (const m of graph.matchAll(edgeLineRe))
      for (const id of m[1].match(anyNode) ?? []) edgeIds.add(id);
    const classed = [];
    for (const m of graph.matchAll(/^ {4}class ([\w,]+) \w+$/gm)) classed.push(...m[1].split(","));

    for (const n of [...edgeIds].filter(n => !nodes.has(n)).sort())
      fail("graph", `${n} appears in an edge but is never declared as a node`);
    for (const n of [...nodes].filter(n => !classed.includes(n)).sort())
      fail("graph", `${n} is declared but has no class (it will render unstyled)`);
    for (const n of [...new Set(classed.filter(x => classed.filter(y => y === x).length > 1))].sort())
      fail("graph", `${n} is assigned to more than one class`);
    for (const i of ids)
      if (!nodes.has(nodeOf(i))) fail("graph", `${i} is missing from the mermaid dependency graph`);
    okIf(["graph"], `mermaid graph complete: ${nodes.size} nodes, all declared, all classed`);

    // The graph IS depends_on, edge by edge. The rule says the graph is generated from
    // the frontmatter and never hand-edited, but for a long time nothing enforced it:
    // the check only looked at nodes, so an edge could be added, dropped or reversed and
    // the build stayed green. A dependency graph that disagrees with the stories is
    // worse than no graph, because planning is read off the picture.
    const fmEdges = new Set();
    for (const i of ids) for (const d of deps.get(i)) fmEdges.add(`${nodeOf(d)} --> ${nodeOf(i)}`);
    const drawn = new Set();
    const drawnRe = new RegExp(`^ {4}(${escapeRe(PREFIX)}\\d+)\\s*-->\\s*(${escapeRe(PREFIX)}\\d+)\\s*$`, "gm");
    for (const m of graph.matchAll(drawnRe)) drawn.add(`${m[1]} --> ${m[2]}`);
    for (const e of [...fmEdges].filter(e => !drawn.has(e)).sort())
      fail("graph", `${e} is declared in depends_on but missing from the mermaid graph`);
    for (const e of [...drawn].filter(e => !fmEdges.has(e)).sort())
      fail("graph", `${e} is drawn in the mermaid graph but no story declares it`);
    okIf(["graph"], `mermaid edges match depends_on exactly: ${fmEdges.size} edges`);
  }
}

// ----------------------------------------------------------------- diagrams
// A diagram nobody maintains is read as current and is not. This catches the mechanical
// half: a dead story reference, and a phase annotated next to a story that has since
// moved. It cannot catch a node crediting the WRONG story — that half belongs to
// whoever owns the diagram, not to this script.
const DIAGRAMS_REL = opt("paths.diagrams");
if (CHECK("diagrams", false) && DIAGRAMS_REL) {
  const DIAGRAMS = join(ROOT, ...DIAGRAMS_REL.split("/"));
  let diagFiles = [];
  try { diagFiles = readdirSync(DIAGRAMS).filter(f => f.endsWith(".md") && f !== "README.md"); }
  catch { fail("diagrams", `cannot read ${DIAGRAMS_REL} — is 'paths.diagrams' right?`); }
  if (diagFiles.length) {
    const citeRe = new RegExp(`${escapeRe(PREFIX)}-(\\d+)`, "g");
    const phaseAlt = PHASES.map(escapeRe).join("|");
    const annotRe = phaseAlt
      ? new RegExp(`${escapeRe(PREFIX)}-(\\d+)\\s*[·\\u00b7-]\\s*(${phaseAlt})\\b`, "g")
      : null;
    let cited = 0, annotated = 0;
    for (const file of diagFiles) {
      const text = readFileSync(join(DIAGRAMS, file), "utf8");
      for (const m of text.matchAll(citeRe)) {
        cited++;
        const id = `${PREFIX}-${parseInt(m[1], 10)}`;
        if (!stories.has(id)) fail("diagrams", `${file} cites ${id}, which is not a story`);
      }
      if (annotRe) for (const m of text.matchAll(annotRe)) {
        annotated++;
        const id = `${PREFIX}-${parseInt(m[1], 10)}`;
        const real = stories.get(id)?.fm?.phase;
        if (real && real !== m[2])
          fail("diagrams", `${file} annotates ${id} as ${m[2]}, but the story is ${real}`);
      }
    }
    okIf(["diagrams"], `diagrams cite real stories: ${cited} reference(s) across ${diagFiles.length} diagram(s), ${annotated} phase annotation(s) checked`);
  }
}

// ------------------------------------------------------------------ verdict
console.log();
if (failures.length) {
  const byCheck = {};
  for (const { check, msg } of failures) (byCheck[check] ??= []).push(msg);
  for (const check of Object.keys(byCheck).sort()) {
    console.log(`FAIL  ${check} (${byCheck[check].length})`);
    for (const msg of byCheck[check]) console.log(`        ${msg}`);
  }
  console.log(`\n${failures.length} problem(s).`);
  process.exit(1);
}
console.log(`All checks passed — ${totalCount} stories, ${totalDays} days, backlog is consistent.`);
process.exit(0);
