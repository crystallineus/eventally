import { ASSISTANT } from "@/lib/persona";

// Aunt Tally's avatar: an elephant auntie's head (fan-shaped ears, a domed head that narrows into a
// curling trunk) with cream curly hair and red glasses.
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
      {/* fan-shaped ears spreading out and down from the sides of the head */}
      <path d="M32 34 C20 24 3 30 3 50 C3 66 14 78 30 70 C33 60 34 46 32 34Z" fill="#7c828b"/>
      <path d="M68 34 C80 24 97 30 97 50 C97 66 86 78 70 70 C67 60 66 46 68 34Z" fill="#7c828b"/>
      <path d="M31 38 C21 31 8 36 8 51 C8 63 16 72 29 66 C31 58 32 47 31 38Z" fill="#949aa3"/>
      <path d="M69 38 C79 31 92 36 92 51 C92 63 84 72 71 66 C69 58 68 47 69 38Z" fill="#949aa3"/>
      <path d="M29 43 C22 39 13 42 13 52 C13 60 19 66 27 62 C29 56 30 49 29 43Z" fill="#e3b3b0" opacity="0.6"/>
      <path d="M71 43 C78 39 87 42 87 52 C87 60 81 66 73 62 C71 56 70 49 71 43Z" fill="#e3b3b0" opacity="0.6"/>
      {/* domed head that narrows into the trunk */}
      <path d="M50 22 C65 22 75 32 75 46 C75 56 69 63 60 65 L40 65 C31 63 25 56 25 46 C25 32 35 22 50 22Z" fill="#8f959e"/>
      <path d="M50 24.5 C62 24.5 71 33 71 45 C71 54 66 60 58 62 L42 62 C34 60 29 54 29 45 C29 33 38 24.5 50 24.5Z" fill="#a3a9b1"/>
      <ellipse cx="50" cy="36" rx="13" ry="9" fill="#b7bcc4"/>
      {/* trunk: wide at the base, tapering, tip curling up */}
      <path d="M40.5 58 C40 70 41 80 45 87 C48 92 55 92 58 88 C59.5 85.5 58.5 82.5 56 82.5 C54.8 82.5 54.4 84 53.4 84.4 C51.6 85 50.6 82 50.6 78 C50.6 70 54 63 59.5 58Z" fill="#a3a9b1"/>
      <path d="M43 61 C42.6 70 43.5 78 46.5 84.5" stroke="#b7bcc4" strokeWidth="2.6" opacity="0.7" strokeLinecap="round"/>
      <g stroke="#7c828b" strokeWidth="1.1" opacity="0.55" strokeLinecap="round">
        <path d="M41.5 66 Q46.5 68 52 65.8"/><path d="M41.8 71 Q46 73 51.2 71"/><path d="M42.6 76 Q46.4 77.8 50.8 76"/><path d="M44 81 Q47 82.6 50.8 81.2"/>
      </g>
      {/* corners of a smile beside the trunk base */}
      <path d="M35 57 Q37.5 60.5 41 60" stroke="#5f646c" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M59 60 Q62.5 60.5 65 57" stroke="#5f646c" strokeWidth="1.5" strokeLinecap="round"/>
      <ellipse cx="33" cy="53" rx="3.6" ry="2.3" fill="#e6a3a0" opacity="0.6"/>
      <ellipse cx="67" cy="53" rx="3.6" ry="2.3" fill="#e6a3a0" opacity="0.6"/>
      {/* cream curly hair on the dome, layered */}
      <g fill="#e2d6bc">
        <circle cx="36" cy="28" r="5.5"/><circle cx="43" cy="23" r="6.5"/><circle cx="50" cy="21.5" r="7"/>
        <circle cx="57" cy="23" r="6.5"/><circle cx="64" cy="28" r="5.5"/>
      </g>
      <g fill="#efe6d2">
        <circle cx="37.5" cy="26.5" r="4.3"/><circle cx="44" cy="21.8" r="5.2"/><circle cx="50" cy="20.3" r="5.6"/>
        <circle cx="56" cy="21.8" r="5.2"/><circle cx="62.5" cy="26.5" r="4.3"/><circle cx="47" cy="27" r="4"/><circle cx="53" cy="27" r="4"/>
      </g>
      <g fill="#faf5ea">
        <circle cx="44.5" cy="20.3" r="2.6"/><circle cx="50" cy="18.8" r="3"/><circle cx="55.5" cy="20.3" r="2.6"/>
        <circle cx="38.3" cy="25.2" r="2.1"/><circle cx="61.7" cy="25.2" r="2.1"/>
      </g>
      {/* small eyes set wide, behind red glasses */}
      <ellipse cx="38.5" cy="46.5" rx="2" ry="2.3" fill="#3b3f46"/>
      <ellipse cx="61.5" cy="46.5" rx="2" ry="2.3" fill="#3b3f46"/>
      <circle cx="39.2" cy="45.6" r="0.6" fill="#ffffff"/>
      <circle cx="62.2" cy="45.6" r="0.6" fill="#ffffff"/>
      <rect x="30.5" y="41" width="16" height="11" rx="5" stroke="#d23f3f" strokeWidth="2.3" fill="rgba(255,255,255,0.15)"/>
      <rect x="53.5" y="41" width="16" height="11" rx="5" stroke="#d23f3f" strokeWidth="2.3" fill="rgba(255,255,255,0.15)"/>
      <path d="M46.5 45.5 Q50 44 53.5 45.5" stroke="#d23f3f" strokeWidth="2.1"/>
      <path d="M30.5 45 L26.5 43.8" stroke="#d23f3f" strokeWidth="2.1" strokeLinecap="round"/>
      <path d="M69.5 45 L73.5 43.8" stroke="#d23f3f" strokeWidth="2.1" strokeLinecap="round"/>
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
