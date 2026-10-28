import { ASSISTANT } from "@/lib/persona";

// Aunt Tally's avatar: an elephant auntie's head with curly brown hair and red glasses.
// Flat layered shapes in the style of Infinite Shelf's Sherman.
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
      {/* ears, back to front tones */}
      <ellipse cx="19" cy="50" rx="18" ry="22" fill="#7d838c"/>
      <ellipse cx="81" cy="50" rx="18" ry="22" fill="#7d838c"/>
      <ellipse cx="20" cy="50" rx="14.5" ry="18.5" fill="#949aa3"/>
      <ellipse cx="80" cy="50" rx="14.5" ry="18.5" fill="#949aa3"/>
      <ellipse cx="21" cy="51" rx="10" ry="13.5" fill="#e6b8b5" opacity="0.55"/>
      <ellipse cx="79" cy="51" rx="10" ry="13.5" fill="#e6b8b5" opacity="0.55"/>
      {/* head, layered */}
      <ellipse cx="50" cy="50" rx="26" ry="27" fill="#8a9099"/>
      <ellipse cx="50" cy="48" rx="23.5" ry="24" fill="#a1a7b0"/>
      <ellipse cx="50" cy="44" rx="16" ry="13" fill="#b4bac2"/>
      {/* trunk */}
      <path d="M43 60 Q41.5 75 43.5 84 Q46 92 52.5 91 Q58 90 57 84.5 Q54.5 85.5 52.8 85 Q50 83.5 50.5 75 Q51 66 57 60Z" fill="#a1a7b0"/>
      <path d="M45 62 Q44 74 46 83" stroke="#b4bac2" strokeWidth="2.4" opacity="0.6" strokeLinecap="round"/>
      <g stroke="#7d838c" strokeWidth="1.1" opacity="0.5" strokeLinecap="round">
        <path d="M44.5 68 Q48 69.5 51.5 68"/><path d="M44.3 73.5 Q47.5 75 50.8 73.5"/><path d="M44.8 79 Q47.6 80.4 50.6 79.3"/>
      </g>
      {/* curly hair: layered curls like Sherman's canopy */}
      <g fill="#6b3f26">
        <circle cx="30" cy="27" r="7"/><circle cx="39" cy="21" r="8"/><circle cx="50" cy="19" r="8.5"/>
        <circle cx="61" cy="21" r="8"/><circle cx="70" cy="27" r="7"/><circle cx="34" cy="31" r="6"/><circle cx="66" cy="31" r="6"/>
      </g>
      <g fill="#8b5a3c">
        <circle cx="32" cy="25" r="5.5"/><circle cx="40.5" cy="19.5" r="6.5"/><circle cx="50" cy="17.5" r="7"/>
        <circle cx="59.5" cy="19.5" r="6.5"/><circle cx="68" cy="25" r="5.5"/><circle cx="45" cy="26" r="5.5"/><circle cx="55" cy="26" r="5.5"/>
      </g>
      <g fill="#a8714d">
        <circle cx="41" cy="17.5" r="3.4"/><circle cx="50" cy="15.5" r="3.8"/><circle cx="59" cy="17.5" r="3.4"/>
        <circle cx="33" cy="23.5" r="2.8"/><circle cx="67" cy="23.5" r="2.8"/><circle cx="46" cy="24" r="2.6"/><circle cx="55" cy="24" r="2.6"/>
      </g>
      {/* cheeks and smile on either side of the trunk */}
      <ellipse cx="33" cy="60" rx="4" ry="2.6" fill="#e6a3a0" opacity="0.6"/>
      <ellipse cx="67" cy="60" rx="4" ry="2.6" fill="#e6a3a0" opacity="0.6"/>
      <path d="M38 62.5 Q40 65 43 64.6" stroke="#5f646c" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M57 64.6 Q60 65 62 62.5" stroke="#5f646c" strokeWidth="1.5" strokeLinecap="round"/>
      {/* eyes and red glasses */}
      <ellipse cx="38" cy="50" rx="2.3" ry="2.6" fill="#3b3f46"/>
      <ellipse cx="62" cy="50" rx="2.3" ry="2.6" fill="#3b3f46"/>
      <circle cx="38.8" cy="49" r="0.7" fill="#ffffff"/>
      <circle cx="62.8" cy="49" r="0.7" fill="#ffffff"/>
      <rect x="29" y="44" width="18" height="12" rx="5" stroke="#d23f3f" strokeWidth="2.4" fill="rgba(255,255,255,0.15)"/>
      <rect x="53" y="44" width="18" height="12" rx="5" stroke="#d23f3f" strokeWidth="2.4" fill="rgba(255,255,255,0.15)"/>
      <path d="M47 49 Q50 47.5 53 49" stroke="#d23f3f" strokeWidth="2.2"/>
      <path d="M29 48 L24 46.5" stroke="#d23f3f" strokeWidth="2.2" strokeLinecap="round"/>
      <path d="M71 48 L76 46.5" stroke="#d23f3f" strokeWidth="2.2" strokeLinecap="round"/>
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
