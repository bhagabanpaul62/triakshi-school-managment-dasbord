// @ts-check
/**
 * Tests for the local ticket tool. Run with: node --test tickets/tools/
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { renderBoard } from "./board.mjs";
import { compareIds, loadTickets, parseFrontmatter, readyTickets, setStatus, validate } from "./model.mjs";
import { run } from "./tickets.mjs";

/** @typedef {import("./model.mjs").Ticket} Ticket */

/**
 * Builds a valid ticket, with fields overridden as needed.
 * @param {Partial<Ticket> & { id: string }} fields
 * @returns {Ticket}
 */
function ticket(fields) {
  const phase = Number(fields.id.slice(1, fields.id.indexOf("-")));
  return {
    title: `Title of ${fields.id}`,
    phase,
    type: "build",
    status: "todo",
    size: "S",
    dependsOn: [],
    file: `phase-${phase}/${fields.id}-title.md`,
    ...fields,
  };
}

/**
 * @param {string} id
 * @param {{ status?: string, deps?: string, title?: string }} [options]
 * @returns {string} Ticket file text.
 */
function ticketText(id, { status = "todo", deps = "[]", title = `Title of ${id}` } = {}) {
  const phase = id.slice(1, id.indexOf("-"));
  return `---\nid: ${id}\ntitle: ${title}\nphase: ${phase}\ntype: build\nstatus: ${status}\nsize: S\ndepends_on: ${deps}\nspec: [8]\n---\n\n# ${id}\n\nstatus: this body line must never change\n`;
}

describe("parseFrontmatter", () => {
  test("reads scalars, lists and titles that contain a colon", () => {
    const fields = parseFrontmatter("---\nid: P0-01\ntitle: Fix: lint\ndepends_on: [P0-02, P0-03]\nspec: []\n---\nbody\n");
    assert.equal(fields.id, "P0-01");
    assert.equal(fields.title, "Fix: lint");
    assert.deepEqual(fields.depends_on, ["P0-02", "P0-03"]);
    assert.deepEqual(fields.spec, []);
  });

  test("accepts Windows line endings", () => {
    assert.equal(parseFrontmatter("---\r\nid: P0-01\r\n---\r\nbody").id, "P0-01");
  });

  test("throws when the frontmatter block is missing", () => {
    assert.throws(() => parseFrontmatter("# just a heading\n"), /missing frontmatter/);
  });
});

describe("validate", () => {
  test("accepts a valid set of tickets", () => {
    assert.deepEqual(validate([ticket({ id: "P0-01" }), ticket({ id: "P0-02", dependsOn: ["P0-01"] })]), []);
  });

  test("reports duplicate ids", () => {
    const errors = validate([ticket({ id: "P0-01" }), ticket({ id: "P0-01", file: "phase-0/P0-01-other.md" })]);
    assert.match(errors.join("\n"), /duplicate id P0-01/);
  });

  test("reports unknown and later-phase dependencies", () => {
    const errors = validate([
      ticket({ id: "P0-01", dependsOn: ["P0-99", "P1-01"] }),
      ticket({ id: "P1-01" }),
    ]).join("\n");
    assert.match(errors, /unknown ticket P0-99/);
    assert.match(errors, /P1-01, which is in a later phase/);
  });

  test("reports bad status, type, size, folder and file name", () => {
    const errors = validate([
      ticket({ id: "P0-01", status: "started", type: "story", size: "XL", file: "phase-1/wrong-name.md" }),
    ]).join("\n");
    assert.match(errors, /status "started"/);
    assert.match(errors, /type "story"/);
    assert.match(errors, /size "XL"/);
    assert.match(errors, /must be in the phase-0 folder/);
    assert.match(errors, /file name must start with "P0-01-"/);
  });

  test("reports an id that does not match its phase", () => {
    assert.match(validate([ticket({ id: "P0-01", phase: 1, file: "phase-1/P0-01-x.md" })]).join("\n"), /does not match phase 1/);
  });

  test("allows size epic only on epic tickets", () => {
    assert.match(validate([ticket({ id: "P6-01", size: "epic" })]).join("\n"), /only epic tickets/);
    assert.deepEqual(validate([ticket({ id: "P6-01", size: "epic", type: "epic" })]), []);
  });

  test("reports a done ticket whose dependency is not done", () => {
    const errors = validate([ticket({ id: "P0-01" }), ticket({ id: "P0-02", status: "done", dependsOn: ["P0-01"] })]);
    assert.match(errors.join("\n"), /is done but depends on a ticket that is not done/);
  });

  test("reports dependency cycles", () => {
    const errors = validate([
      ticket({ id: "P0-01", dependsOn: ["P0-03"] }),
      ticket({ id: "P0-02", dependsOn: ["P0-01"] }),
      ticket({ id: "P0-03", dependsOn: ["P0-02"] }),
    ]);
    assert.match(errors.join("\n"), /dependency cycle: P0-0\d -> P0-0\d -> P0-0\d -> P0-0\d/);
  });
});

describe("readyTickets and compareIds", () => {
  test("returns todo tickets whose dependencies are all done, in id order", () => {
    const ready = readyTickets([
      ticket({ id: "P1-01", dependsOn: ["P0-02"] }),
      ticket({ id: "P0-10", dependsOn: ["P0-01"] }),
      ticket({ id: "P0-01", status: "done" }),
      ticket({ id: "P0-02", status: "doing" }),
      ticket({ id: "P0-03" }),
    ]);
    assert.deepEqual(ready.map((t) => t.id), ["P0-03", "P0-10"]);
  });

  test("sorts numerically within and across phases", () => {
    assert.deepEqual(["P2-10", "P10-01", "P2-09", "P0-01"].sort(compareIds), ["P0-01", "P2-09", "P2-10", "P10-01"]);
  });
});

describe("setStatus", () => {
  test("changes only the frontmatter status line", () => {
    const updated = setStatus(ticketText("P0-01"), "doing");
    assert.match(updated, /^status: doing$/m);
    assert.match(updated, /status: this body line must never change/);
  });

  test("throws when there is no frontmatter", () => {
    assert.throws(() => setStatus("no frontmatter", "done"), /missing frontmatter/);
  });
});

describe("renderBoard", () => {
  test("lists ready tickets, work in flight, progress counts and escapes pipes", () => {
    const board = renderBoard([
      ticket({ id: "P0-01", status: "done" }),
      ticket({ id: "P0-02", dependsOn: ["P0-01"], title: "Use a | pipe" }),
      ticket({ id: "P0-03", status: "review" }),
    ]);
    assert.match(board, /## Ready to start\n\n- \[P0-02\]\(phase-0\/P0-02-title\.md\)/);
    assert.match(board, /\[P0-03\].*\*\*review\*\*/);
    assert.match(board, /\| Phase 0: Foundation \| 1 \| 0 \| 0 \| 1 \| 1 \| 3 \|/);
    assert.match(board, /Use a \\\| pipe/);
  });
});

describe("loadTickets and run", () => {
  /** @type {string} */
  let root = "";

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "tickets-test-"));
    mkdirSync(join(root, "phase-0"));
    writeFileSync(join(root, "phase-0", "P0-01-first.md"), ticketText("P0-01"));
    writeFileSync(join(root, "phase-0", "P0-02-second.md"), ticketText("P0-02", { deps: "[P0-01]" }));
    writeFileSync(join(root, "README.md"), "not a ticket");
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test("loads tickets only from phase folders", () => {
    const { tickets, errors } = loadTickets(root);
    assert.deepEqual(errors, []);
    assert.deepEqual(tickets.map((t) => t.id).sort(), ["P0-01", "P0-02"]);
  });

  test("reports a file with missing fields instead of crashing", () => {
    writeFileSync(join(root, "phase-0", "P0-03-broken.md"), "---\nid: P0-03\n---\n");
    const { errors } = loadTickets(root);
    assert.match(errors.join("\n"), /P0-03-broken\.md: missing "title"/);
  });

  test("set changes the file and regenerates the board", () => {
    assert.equal(run(["set", "P0-01", "done"], root), 0);
    assert.match(readFileSync(join(root, "phase-0", "P0-01-first.md"), "utf8"), /^status: done$/m);
    assert.match(readFileSync(join(root, "BOARD.md"), "utf8"), /## Ready to start\n\n- \[P0-02\]/);
  });

  test("set refuses a change that breaks the rules and leaves the file alone", () => {
    const before = readFileSync(join(root, "phase-0", "P0-02-second.md"), "utf8");
    assert.equal(run(["set", "P0-02", "done"], root), 1);
    assert.equal(readFileSync(join(root, "phase-0", "P0-02-second.md"), "utf8"), before);
  });

  test("set refuses an unknown id or status", () => {
    assert.equal(run(["set", "P9-99", "done"], root), 1);
    assert.equal(run(["set", "P0-01", "finished"], root), 1);
  });

  test("check fails on invalid tickets and unknown commands fail", () => {
    assert.equal(run(["check"], root), 0);
    writeFileSync(join(root, "phase-0", "P0-03-bad.md"), ticketText("P0-03", { status: "started" }));
    assert.equal(run(["check"], root), 1);
    assert.equal(run(["launch"], root), 1);
  });
});
