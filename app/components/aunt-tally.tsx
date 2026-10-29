import Image from "next/image";
import { ASSISTANT } from "@/lib/persona";

// Aunt Tally's avatar, which doubles as the EvenTally logo: a round crop of her portrait (an elephant
// auntie in a barrister's wig, red glasses, and a navy robe). A temporary bitmap; the hand-drawn
// version is in public/eventally-logo.svg.
// Decorative next to her name; pass `label` when it stands alone.
export function AuntTallyAvatar({ size = 28, label }: { size?: number; label?: boolean }) {
  return (
    <Image
      src="/eventally-logo.png"
      width={size}
      height={size}
      alt={label ? `${ASSISTANT.name}, ${ASSISTANT.disclosure}` : ""}
      aria-hidden={label ? undefined : true}
      className="shrink-0 rounded-full"
    />
  );
}

/** "Aunt Tally · AI assistant" with her avatar. */
export function AuntTallyName({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <AuntTallyAvatar size={size} />
      <span className="font-medium">{ASSISTANT.name}</span>
      <span className="rounded bg-stone-100 px-1 text-[10px] font-semibold tracking-wide text-stone-500 uppercase">AI</span>
    </span>
  );
}
