"use server";

import { serviceAction } from "@smw/runtime";
import { CounterService } from "../../service";

const id = (fd: FormData) => String(fd.get("id") ?? "");

export async function withdrawDifference(fd: FormData) { return serviceAction(CounterService, (s) => s.withdraw(id(fd)), "Request withdrawn"); }
export async function askDifferenceAgain(fd: FormData) { return serviceAction(CounterService, (s) => s.askAgain(id(fd)), "Sent for approval"); }
export async function reopenCounter(fd: FormData) { return serviceAction(CounterService, (s) => s.reopen(id(fd)), "Counter open. Count again, then close."); }
