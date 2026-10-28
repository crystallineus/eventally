import { ASSISTANT } from "@/lib/persona";

// Aunt Tally's avatar: an elephant auntie in gold glasses, a teal cardigan and pearls, with a
// pencil tucked behind her ear. Flat layered shapes in the style of Infinite Shelf's Sherman.
// Decorative next to her name; pass `label` when it stands alone.
export function AuntTallyAvatar({ size = 28, label }: { size?: number; label?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      role={label ? "img" : undefined}
      aria-label={label ? `${ASSISTANT.name}, ${ASSISTANT.disclosure}` : undefined}
      aria-hidden={label ? undefined : true}
      className="shrink-0"
    >
      {/* cardigan and shoulders */}
      <path d="M14 100 Q16 80 34 76 L66 76 Q84 80 86 100Z" fill="#2f7d72"/>
      <path d="M22 100 Q24 84 38 79 L62 79 Q76 84 78 100Z" fill="#3a9486"/>
      <path d="M42 78 L50 92 L58 78Z" fill="#f3ead8"/>
      {/* pearls */}
      <g fill="#fbf7ee" stroke="#e2d6bd" strokeWidth="0.4">
        <circle cx="38" cy="79" r="1.7"/><circle cx="41.5" cy="82" r="1.7"/><circle cx="45.5" cy="84.2" r="1.7"/>
        <circle cx="50" cy="85" r="1.7"/><circle cx="54.5" cy="84.2" r="1.7"/><circle cx="58.5" cy="82" r="1.7"/><circle cx="62" cy="79" r="1.7"/>
      </g>
      {/* pencil tucked behind the right ear: drawn before the ears so only the top pokes out */}
      <path d="M66 8 L82 26" stroke="#f0b429" strokeWidth="4" strokeLinecap="round"/>
      <path d="M66 8 L67.8 10" stroke="#e58a8a" strokeWidth="4" strokeLinecap="round"/>
      {/* neck */}
      <ellipse cx="50" cy="71" rx="11.5" ry="8.5" fill="#757b84"/>
      {/* ears, back to front tones */}
      <ellipse cx="20" cy="42" rx="19" ry="23" fill="#7d838c"/>
      <ellipse cx="80" cy="42" rx="19" ry="23" fill="#7d838c"/>
      <ellipse cx="21" cy="42" rx="15.5" ry="19.5" fill="#949aa3"/>
      <ellipse cx="79" cy="42" rx="15.5" ry="19.5" fill="#949aa3"/>
      <ellipse cx="22" cy="43" rx="10.5" ry="14" fill="#e6b8b5" opacity="0.55"/>
      <ellipse cx="78" cy="43" rx="10.5" ry="14" fill="#e6b8b5" opacity="0.55"/>
      {/* head, layered */}
      <ellipse cx="50" cy="40" rx="26" ry="27" fill="#8a9099"/>
      <ellipse cx="50" cy="37" rx="23.5" ry="24" fill="#a1a7b0"/>
      <ellipse cx="50" cy="31" rx="17" ry="15" fill="#b4bac2"/>
      <ellipse cx="50" cy="25" rx="9" ry="7" fill="#c4c9d0"/>
      {/* trunk */}
      <path d="M43 50 Q42 64 44 72 Q46 79 52 78 Q57 77 56 72 Q54 73 52.5 72.5 Q50 71 50.5 64 Q51 56 57 50Z" fill="#a1a7b0"/>
      <path d="M45 52 Q44 63 46 71" stroke="#b4bac2" strokeWidth="2.4" opacity="0.6" strokeLinecap="round"/>
      <g stroke="#7d838c" strokeWidth="1.1" opacity="0.5" strokeLinecap="round">
      <path d="M44.5 58 Q48 59.5 51.5 58"/><path d="M44.3 63 Q47.5 64.5 50.8 63"/><path d="M44.8 68 Q47.6 69.4 50.6 68.3"/>
      </g>
      {/* cheeks and smile on either side of the trunk */}
      <ellipse cx="33" cy="50" rx="4" ry="2.6" fill="#e6a3a0" opacity="0.55"/>
      <ellipse cx="67" cy="50" rx="4" ry="2.6" fill="#e6a3a0" opacity="0.55"/>
      <path d="M38 52.5 Q40 55 43 54.6" stroke="#5f646c" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M57 54.6 Q60 55 62 52.5" stroke="#5f646c" strokeWidth="1.5" strokeLinecap="round"/>
      {/* eyes and Sherman-style gold glasses */}
      <ellipse cx="38" cy="41" rx="2.3" ry="2.6" fill="#3b3f46"/>
      <ellipse cx="62" cy="41" rx="2.3" ry="2.6" fill="#3b3f46"/>
      <circle cx="38.8" cy="40" r="0.7" fill="#ffffff"/>
      <circle cx="62.8" cy="40" r="0.7" fill="#ffffff"/>
      <rect x="29" y="35" width="18" height="12" rx="5" stroke="#c8a060" strokeWidth="2.2" fill="rgba(255,255,255,0.15)"/>
      <rect x="53" y="35" width="18" height="12" rx="5" stroke="#c8a060" strokeWidth="2.2" fill="rgba(255,255,255,0.15)"/>
      <path d="M47 40 Q50 38.5 53 40" stroke="#c8a060" strokeWidth="2"/>
      <path d="M29 39 L24 37.5" stroke="#c8a060" strokeWidth="2" strokeLinecap="round"/>
      <path d="M71 39 L76 37.5" stroke="#c8a060" strokeWidth="2" strokeLinecap="round"/>
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
