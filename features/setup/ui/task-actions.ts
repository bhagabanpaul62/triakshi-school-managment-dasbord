"use server";

import { revalidatePath } from "next/cache";
import { actionCtx, runAction, serviceAction } from "@smw/runtime";
import { SetupTaskService } from "../task-service";

/** The sidebar entry and the page both read the same numbers, so every change refreshes both. */
const fresh = () => { revalidatePath("/app/getting-started"); revalidatePath("/app", "layout"); };

export async function assignTask(input: { key: string; userId: string }) {
  const r = await serviceAction(SetupTaskService, (s) => s.assign(input));
  fresh();
  return r.ok ? { ...r, message: r.data.warning ? `Given to ${r.data.name}. ${r.data.warning}` : `Given to ${r.data.name}. They are told.` } : r;
}
export async function unassignTask(input: { key: string }) {
  const r = await serviceAction(SetupTaskService, (s) => s.unassign(input), "Taken back");
  fresh();
  return r;
}
export async function skipTask(input: { key: string; reason: string }) {
  const r = await serviceAction(SetupTaskService, (s) => s.skip(input), "Left out. You can bring it back below.");
  fresh();
  return r;
}
export async function restoreTask(input: { key: string }) {
  const r = await serviceAction(SetupTaskService, (s) => s.restore(input), "Brought back");
  fresh();
  return r;
}

/** `<form action>` on the home card: hides it for the whole school. */
export async function hideGettingStarted(): Promise<void> {
  await runAction(async () => new SetupTaskService(await actionCtx()).setCardHidden(true));
  fresh();
}
export async function showGettingStarted(): Promise<void> {
  await runAction(async () => new SetupTaskService(await actionCtx()).setCardHidden(false));
  fresh();
}
