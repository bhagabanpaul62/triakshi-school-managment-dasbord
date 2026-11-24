import { SkeletonRows } from "@smw/ui/finance/States";

export default function BillingLoading() {
  return <div className="pt-2"><div className="h-8 w-56 animate-pulse rounded-full bg-white/[0.06] motion-reduce:animate-none" /><SkeletonRows className="mt-8" rows={8} /></div>;
}
