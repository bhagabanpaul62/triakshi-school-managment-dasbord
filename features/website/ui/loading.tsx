import { SkeletonRows } from "@smw/ui/finance/States";

/** Every Website screen shows this while it loads. */
export default function WebsiteLoading() {
  return (
    <div className="pt-2" aria-busy="true">
      <div className="pb-8">
        <div className="h-3 w-24 animate-pulse rounded-full bg-white/[0.06] motion-reduce:animate-none" />
        <div className="mt-3 h-8 w-64 animate-pulse rounded-full bg-white/[0.06] motion-reduce:animate-none" />
      </div>
      <SkeletonRows rows={6} />
    </div>
  );
}
