// @ts-check
/**
 * Command-line entry for the local ticket system.
 * Usage: node tickets/tools/tickets.mjs <check | next | board | set <id> <status>>
 * It uses only Node's standard library, so it works before `pnpm install`.
 * @module tickets/cli
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderBoard } from "./board.mjs";
import { STATUSES, loadTickets, readyTickets, setStatus, validate } from "./model.mjs";

const USAGE = "Usage: node tickets/tools/tickets.mjs <check | next | board | set <id> <status>>";

/** @param {string[]} errors */
function printErrors(errors) {
  for (const error of errors) console.error(`- ${error}`);
  console.error(`${errors.length} problem(s) found.`);
}

/**
 * Runs one command of the CLI.
 * @param {string[]} args Arguments after the script path, such as ["set", "P0-04", "doing"].
 * @param {string} root Path to the tickets folder.
 * @returns {number} Exit code: 0 on success, 1 on any problem.
 */
export function run(args, root) {
  const [command, ...rest] = args;
  const { tickets, errors: loadErrors } = loadTickets(root);
  const errors = [...loadErrors, ...validate(tickets)];

  if (command === "check") {
    if (errors.length > 0) {
      printErrors(errors);
      return 1;
    }
    console.log(`${tickets.length} tickets OK.`);
    return 0;
  }
  if (!["next", "board", "set"].includes(command ?? "")) {
    console.error(USAGE);
    return 1;
  }
  if (errors.length > 0) {
    printErrors(errors);
    return 1;
  }
  if (command === "next") {
    const ready = readyTickets(tickets);
    if (ready.length === 0) console.log("Nothing is ready to start.");
    for (const t of ready) console.log(`${t.id}  ${t.title}  (${t.type}, ${t.size})  tickets/${t.file}`);
    return 0;
  }
  if (command === "board") {
    writeFileSync(join(root, "BOARD.md"), renderBoard(tickets));
    console.log("BOARD.md updated.");
    return 0;
  }

  const [id, status] = rest;
  const ticket = tickets.find((t) => t.id === id);
  if (!ticket) {
    console.error(`Unknown ticket "${id ?? ""}". ${USAGE}`);
    return 1;
  }
  if (!status || !STATUSES.includes(status)) {
    console.error(`Status must be one of ${STATUSES.join(", ")}.`);
    return 1;
  }
  const updated = tickets.map((t) => (t.id === id ? { ...t, status } : t));
  const newErrors = validate(updated);
  if (newErrors.length > 0) {
    printErrors(newErrors);
    return 1;
  }
  const path = join(root, ticket.file);
  writeFileSync(path, setStatus(readFileSync(path, "utf8"), status));
  writeFileSync(join(root, "BOARD.md"), renderBoard(updated));
  console.log(`${id} is now ${status}. BOARD.md updated.`);
  return 0;
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === thisFile) {
  process.exitCode = run(process.argv.slice(2), dirname(dirname(thisFile)));
}
