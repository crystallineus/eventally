import { ASSISTANT } from "@/lib/persona";

// Aunt Tally's avatar: a friendly aunt with a silver bun and round glasses, drawn inline so it
// needs no image file. Decorative next to her name; pass `label` when it stands alone.
export function AuntTallyAvatar({ size = 28, label }: { size?: number; label?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      role={label ? "img" : undefined}
      aria-label={label ? `${ASSISTANT.name}, ${ASSISTANT.disclosure}` : undefined}
      aria-hidden={label ? undefined : true}
      className="shrink-0"
    >
      <circle cx="20" cy="20" r="20" fill="#fde7c8" />
      {/* bun and hair */}
      <circle cx="20" cy="7.5" r="5" fill="#b8b2ad" />
      <path d="M8.5 20c0-7.5 5-12 11.5-12s11.5 4.5 11.5 12c-2-3.5-6.5-5.5-11.5-5.5S10.5 16.5 8.5 20z" fill="#c9c3be" />
      {/* face */}
      <ellipse cx="20" cy="22" rx="10" ry="11" fill="#f2c9a0" />
      {/* glasses */}
      <circle cx="15.8" cy="21" r="3.4" fill="#fff" fillOpacity="0.55" stroke="#5b3a29" strokeWidth="1.3" />
      <circle cx="24.2" cy="21" r="3.4" fill="#fff" fillOpacity="0.55" stroke="#5b3a29" strokeWidth="1.3" />
      <path d="M19.2 21h1.6" stroke="#5b3a29" strokeWidth="1.3" />
      <circle cx="15.8" cy="21.3" r="1" fill="#3b2a20" />
      <circle cx="24.2" cy="21.3" r="1" fill="#3b2a20" />
      {/* cheeks and smile */}
      <circle cx="13.2" cy="26" r="1.6" fill="#e9967a" fillOpacity="0.6" />
      <circle cx="26.8" cy="26" r="1.6" fill="#e9967a" fillOpacity="0.6" />
      <path d="M16.5 27.2c2 2 5 2 7 0" stroke="#7a3e2b" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      {/* pencil tucked in the bun */}
      <path d="M23.5 3.5l5 5" stroke="#f0b429" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
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
