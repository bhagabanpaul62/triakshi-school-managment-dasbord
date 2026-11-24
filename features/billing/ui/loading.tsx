import { SkeletonRows } from "@smw/ui/finance/States";

export default function BillingLoading() {
  return (
    <div className="pt-2">
      <div className="pb-8">
        <div className="h-3 w-24 animate-pulse rounded-full bg-white/[0.06] motion-reduce:animate-none" />
        <div className="mt-3 h-8 w-64 animate-pulse rounded-full bg-white/[0.06] motion-reduce:animate-none" />
      </div>
      <SkeletonRows rows={8} />
    </div>
  );
}
