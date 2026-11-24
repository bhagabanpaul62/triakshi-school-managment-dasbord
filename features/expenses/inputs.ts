import { z } from "zod";
import { OUT_METHODS } from "./constants";

export const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-24.");
export const paiseAmount = z.coerce.number().int().positive("Enter an amount above zero.").max(100_000_000_000_00);
export const optionalId = z.preprocess((v) => (v === "" ? undefined : v), z.uuid().nullish());
export const method = z.enum(OUT_METHODS);
export const note = (n = 300) => z.string().trim().max(n).optional();
