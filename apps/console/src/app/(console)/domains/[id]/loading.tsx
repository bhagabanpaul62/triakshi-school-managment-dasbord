import { SkeletonRows } from "@smw/ui/finance/States";

export default function DomainsLoading() {
  return <div className="pt-2"><div className="mb-8 h-8 w-64 animate-pulse rounded-full bg-white/[0.06] motion-reduce:animate-none" /><SkeletonRows rows={6} /></div>;
}
