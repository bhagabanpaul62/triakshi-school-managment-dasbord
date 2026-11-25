// The urgent alert a school can send instead of a closure, filled in for the notice writer (`/app/announcements/new`).

/** `title` is the alert's title; the text asks families to say they are safe. */
export const urgentAlertHref = (title: string) =>
  `/app/announcements/new?${new URLSearchParams({ kind: "urgent", title, text: `${title}. Please do not send your child to school until we tell you. Press I am safe so we know you have seen this.` })}`;
