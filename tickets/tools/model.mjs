// @ts-check
/**
 * Ticket model: reads ticket files, validates them, works out which tickets are ready,
 * and rewrites a ticket's status. Uses only Node's standard library.
 * @module tickets/model
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** @type {readonly string[]} Allowed statuses, in board column order. */
export const STATUSES = ["todo", "doing", "blocked", "review", "done"];
/** @type {readonly string[]} Allowed ticket types. */
export const TYPES = ["build", "chore", "spike", "owner", "checkpoint", "epic"];
/** @type {readonly string[]} Allowed sizes. Only epics use "epic". */
export const SIZES = ["XS", "S", "M", "L", "epic"];

const REQUIRED_FIELDS = ["id", "title", "phase", "type", "status", "size", "depends_on"];
const ID_PATTERN = /^P(\d+)-(\d{2,})$/;
/**
 * @typedef {object} Ticket
 * @property {string} id         For example "P0-04".
 * @property {string} title
 * @property {number} phase
 * @property {string} type
 * @property {string} status
 * @property {string} size
 * @property {string[]} dependsOn IDs that must be done before this ticket can start.
 * @property {string} file       Path relative to the tickets folder, such as "phase-0/P0-04-fix-lint.md".
 */

/**
 * Parses the restricted frontmatter that ticket files use: `key: value` lines and `[a, b]` lists.
 * @param {string} text Full file contents.
 * @returns {Record<string, string | string[]>} The parsed fields.
 * @throws {Error} When the file has no frontmatter block or a line is not `key: value`.
 */
export function parseFrontmatter(text) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text.replace(/\r\n/g, "\n"));
  if (!match) throw new Error("missing frontmatter block");
  /** @type {Record<string, string | string[]>} */
  const fields = {};
  for (const line of match[1].split("\n")) {
    if (line.trim() === "") continue;
    const separator = line.indexOf(":");
    if (separator < 1) throw new Error(`bad frontmatter line "${line}"`);
    const key = line.slice(0, separator).trim();
    const raw = line.slice(separator + 1).trim();
    fields[key] =
      raw.startsWith("[") && raw.endsWith("]")
        ? raw.slice(1, -1).split(",").map((item) => item.trim()).filter(Boolean)
        : raw;
  }
  return fields;
}

/**
 * Builds a Ticket from parsed frontmatter, reporting missing or malformed fields.
 * @param {Record<string, string | string[]>} fields Output of parseFrontmatter.
 * @param {string} file Path relative to the tickets folder, used in error messages.
 * @returns {{ ticket: Ticket | null, errors: string[] }} The ticket, or null with errors.
 */
export function toTicket(fields, file) {
  const errors = REQUIRED_FIELDS.filter((key) => !(key in fields)).map((key) => `${file}: missing "${key}"`);
  const deps = fields.depends_on;
  if (deps !== undefined && !Array.isArray(deps)) errors.push(`${file}: depends_on must be a list such as [P0-01]`);
  if (errors.length > 0) return { ticket: null, errors };
  /** @param {string} key */
  const text = (key) => {
    const value = fields[key];
    return Array.isArray(value) ? value.join(", ") : value;
  };
  return {
    ticket: {
      id: text("id"),
      title: text("title"),
      phase: Number(text("phase")),
      type: text("type"),
      status: text("status"),
      size: text("size"),
      dependsOn: Array.isArray(deps) ? deps : [],
      file,
    },
    errors: [],
  };
}

/**
 * Reads every ticket file in the `phase-*` folders under the tickets folder.
 * @param {string} root Path to the tickets folder.
 * @returns {{ tickets: Ticket[], errors: string[] }} Parsed tickets and any read or parse errors.
 */
export function loadTickets(root) {
  /** @type {Ticket[]} */
  const tickets = [];
  /** @type {string[]} */
  const errors = [];
  const phaseDirs = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("phase-"))
    .map((entry) => entry.name);
  for (const dir of phaseDirs) {
    for (const name of readdirSync(join(root, dir)).filter((n) => n.endsWith(".md"))) {
      const file = `${dir}/${name}`;
      try {
        const result = toTicket(parseFrontmatter(readFileSync(join(root, file), "utf8")), file);
        errors.push(...result.errors);
        if (result.ticket) tickets.push(result.ticket);
      } catch (error) {
        errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return { tickets, errors };
}

/**
 * Splits an ID such as "P2-10" into its phase and number.
 * @param {string} id
 * @returns {[number, number]} Phase and number, or Infinity for a malformed ID.
 */
function idParts(id) {
  const match = ID_PATTERN.exec(id);
  return match ? [Number(match[1]), Number(match[2])] : [Infinity, Infinity];
}

/**
 * Orders ticket IDs by phase and then by number, so "P2-10" sorts after "P2-09".
 * @param {string} a
 * @param {string} b
 * @returns {number} Negative, zero or positive, as Array.prototype.sort expects.
 */
export function compareIds(a, b) {
  const [phaseA, numberA] = idParts(a);
  const [phaseB, numberB] = idParts(b);
  return phaseA - phaseB || numberA - numberB || a.localeCompare(b);
}

/**
 * Finds dependency cycles, because a cycle means none of its tickets can ever start.
 * @param {Ticket[]} tickets
 * @param {Map<string, Ticket>} byId
 * @returns {string[]} One message per cycle found.
 */
function findCycles(tickets, byId) {
  /** @type {Map<string, "visiting" | "visited">} */
  const state = new Map();
  /** @type {string[]} */
  const errors = [];
  /**
   * @param {string} id
   * @param {string[]} path IDs from the starting ticket down to the parent of `id`.
   */
  const visit = (id, path) => {
    if (state.get(id) === "visited") return;
    if (state.get(id) === "visiting") {
      errors.push(`dependency cycle: ${[...path.slice(path.indexOf(id)), id].join(" -> ")}`);
      return;
    }
    state.set(id, "visiting");
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      if (byId.has(dep)) visit(dep, [...path, id]);
    }
    state.set(id, "visited");
  };
  for (const ticket of tickets) visit(ticket.id, []);
  return errors;
}

/**
 * Checks every ticket against the rules in tickets/README.md.
 * @param {Ticket[]} tickets
 * @returns {string[]} Human-readable problems. Empty when everything is valid.
 */
export function validate(tickets) {
  /** @type {string[]} */
  const errors = [];
  /** @type {Map<string, Ticket>} */
  const byId = new Map();
  for (const ticket of tickets) {
    const existing = byId.get(ticket.id);
    if (existing) errors.push(`${ticket.file}: duplicate id ${ticket.id}, also used by ${existing.file}`);
    else byId.set(ticket.id, ticket);
  }
  for (const t of tickets) {
    const match = ID_PATTERN.exec(t.id);
    if (!match) errors.push(`${t.file}: id "${t.id}" must look like P0-01`);
    else if (Number(match[1]) !== t.phase) errors.push(`${t.file}: id ${t.id} does not match phase ${t.phase}`);
    if (!t.file.startsWith(`phase-${t.phase}/`)) errors.push(`${t.file}: must be in the phase-${t.phase} folder`);
    if (!t.file.slice(t.file.indexOf("/") + 1).startsWith(`${t.id}-`)) {
      errors.push(`${t.file}: file name must start with "${t.id}-"`);
    }
    if (!STATUSES.includes(t.status)) errors.push(`${t.file}: status "${t.status}" must be one of ${STATUSES.join(", ")}`);
    if (!TYPES.includes(t.type)) errors.push(`${t.file}: type "${t.type}" must be one of ${TYPES.join(", ")}`);
    if (!SIZES.includes(t.size)) errors.push(`${t.file}: size "${t.size}" must be one of ${SIZES.join(", ")}`);
    if ((t.size === "epic") !== (t.type === "epic")) errors.push(`${t.file}: only epic tickets use size "epic"`);
    for (const dep of t.dependsOn) {
      const target = byId.get(dep);
      if (!target) errors.push(`${t.file}: depends on unknown ticket ${dep}`);
      else if (target.phase > t.phase) errors.push(`${t.file}: depends on ${dep}, which is in a later phase`);
    }
    if (t.status === "done" && t.dependsOn.some((dep) => byId.get(dep)?.status !== "done")) {
      errors.push(`${t.file}: is done but depends on a ticket that is not done`);
    }
  }
  errors.push(...findCycles(tickets, byId));
  return errors;
}

/**
 * Lists tickets that can start now: status todo and every dependency done.
 * @param {Ticket[]} tickets
 * @returns {Ticket[]} Ready tickets in ID order.
 */
export function readyTickets(tickets) {
  const statusById = new Map(tickets.map((t) => [t.id, t.status]));
  return tickets
    .filter((t) => t.status === "todo" && t.dependsOn.every((dep) => statusById.get(dep) === "done"))
    .sort((a, b) => compareIds(a.id, b.id));
}

/**
 * Returns the ticket file text with the frontmatter status replaced. The body is untouched.
 * @param {string} text Full ticket file contents.
 * @param {string} status New status.
 * @returns {string} Updated file contents.
 * @throws {Error} When the file has no frontmatter block or no status line in it.
 */
export function setStatus(text, status) {
  const end = text.indexOf("\n---", 3);
  if (!text.startsWith("---") || end < 0) throw new Error("missing frontmatter block");
  const head = text.slice(0, end);
  if (!/^status:.*$/m.test(head)) throw new Error("frontmatter has no status line");
  return head.replace(/^status:.*$/m, `status: ${status}`) + text.slice(end);
}
