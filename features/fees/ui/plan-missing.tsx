import { Notice } from "./shared";

/** A plan is made of fee heads and classes. When one is missing, say which and link to where it is added, then come back here. */
export function PlanMissing({ heads, classes, back }: { heads: number; classes: number; back: string }) {
  const next = encodeURIComponent(back);
  return (
    <>
      {heads ? null : <Notice action={{ href: `/app/fees/heads?next=${next}`, label: "Add fee heads" }}>There are no fee heads yet, like Tuition. A plan is made of them.</Notice>}
      {classes ? null : <Notice action={{ href: `/app/academics?next=${next}`, label: "Add classes" }}>There are no classes yet. A plan is for the classes that pay it.</Notice>}
    </>
  );
}
