import type { z } from "zod";

/** Every expected failure is an AppError: actions and the REST API turn it into a clean response. */
export class AppError extends Error {
  constructor(message: string, readonly code: string, readonly status: number, readonly fieldErrors?: Record<string, string>) {
    super(message);
    this.name = new.target.name;
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to do this.") { super(message, "forbidden", 403); }
}
export class FeatureOffError extends AppError {
  constructor(readonly feature: string) { super("This module is not enabled for your school.", "feature_off", 403); }
}
export class ReadOnlyError extends AppError {
  constructor() { super("Your school is read-only. Renew the plan to make changes.", "read_only", 423); }
}
export class NotFoundError extends AppError {
  constructor(what = "Record") { super(`${what} not found.`, "not_found", 404); }
}
export class ConflictError extends AppError {
  constructor(message: string) { super(message, "conflict", 409); }
}
export class LimitError extends AppError {
  constructor(message: string) { super(message, "limit", 402); }
}
export class ValidationError extends AppError {
  constructor(fieldErrors: Record<string, string>, message = "Please fix the highlighted fields.") {
    super(message, "validation", 422, fieldErrors);
  }
}
export class UnauthenticatedError extends AppError {
  constructor() { super("Please sign in.", "unauthenticated", 401); }
}

/** Parse input with a zod schema, or throw a ValidationError keyed by field path. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const r = schema.safeParse(input);
  if (r.success) return r.data;
  const fieldErrors: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const key = issue.path.join(".") || "_";
    fieldErrors[key] ??= issue.message;
  }
  throw new ValidationError(fieldErrors);
}

/** Postgres unique violation → a friendly ConflictError. */
export function rethrowUnique(err: unknown, message: string): never {
  const code = (err as { code?: string; cause?: { code?: string } })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
  if (code === "23505") throw new ConflictError(message);
  throw err;
}
