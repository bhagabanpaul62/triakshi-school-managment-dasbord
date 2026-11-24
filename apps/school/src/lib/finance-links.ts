/** Where a journal entry's source document opens, by the `sourceType` each module posts with. Other streams add their rows; an unknown type shows as plain text. */
const ROUTES: Record<string, (id: string) => string> = {
  manual: () => "/app/finance/approvals?status=approved",
};

export function sourceHref(sourceType: string, sourceId: string | null): string | null {
  return sourceId ? ROUTES[sourceType]?.(sourceId) ?? null : null;
}
