import { notFound } from "next/navigation";
import { AppError } from "@smw/feature-kit";

/** A page whose record is missing or not the caller's shows the 404 page; any other failure still surfaces. */
export async function orNotFound<T>(work: Promise<T>): Promise<T> {
  try { return await work; } catch (err) {
    if (err instanceof AppError) notFound();
    throw err;
  }
}
