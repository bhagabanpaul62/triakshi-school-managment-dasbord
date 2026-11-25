"use server";

import { serviceAction } from "@smw/runtime";
import { PreferenceService } from "../prefs";

export async function saveGroupPref(input: unknown) { return serviceAction(PreferenceService, (s) => s.saveGroup(input)); }
export async function saveQuietHours(input: unknown) { return serviceAction(PreferenceService, (s) => s.saveQuiet(input), "Quiet hours saved"); }
export async function saveDigestHour(hour: unknown) { return serviceAction(PreferenceService, (s) => s.saveDigest(hour)); }
export async function saveLanguage(language: unknown) { return serviceAction(PreferenceService, (s) => s.saveLanguage(language)); }
export async function saveAway(until: unknown, text?: unknown) { return serviceAction(PreferenceService, (s) => s.setAway(until, text), "Away message saved"); }
export async function removeDevice(id: string) { return serviceAction(PreferenceService, (s) => s.removeDevice(String(id)), "Device removed"); }
