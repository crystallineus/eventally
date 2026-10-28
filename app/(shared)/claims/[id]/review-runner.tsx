"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { AuntTallyAvatar } from "@/app/components/aunt-tally";
import { ASSISTANT } from "@/lib/persona";

// While a claim is in review: start the agent once, and refresh the page every couple of
// seconds so each check appears as the agent records it.
export function ReviewRunner({ claimId }: { claimId: string }) {
  const router = useRouter();
  const started = useRef(false);

  useEffect(() => {
    if (!started.current) {
      started.current = true;
      fetch(`/api/claims/${claimId}/review`, { method: "POST" }).finally(() => router.refresh());
    }
    const timer = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(timer);
  }, [claimId, router]);

  return (
    <p className="flex items-center gap-2 text-sm text-sky-800">
      <AuntTallyAvatar size={22} />
      <span className="size-2 animate-pulse rounded-full bg-sky-500" aria-hidden />
      {ASSISTANT.name} is reviewing the evidence…
    </p>
  );
}
