"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { AuntTallyAvatar } from "@/app/components/aunt-tally";
import { resizeImage } from "@/app/components/resize-images";
import { ASSISTANT } from "@/lib/persona";

type Message = { role: "user" | "assistant"; text: string; photos?: Photo[] };
type Pending = { action: { kind: string }; title: string; lines: string[]; confirmLabel: string; needsPhotos?: boolean };
type Kind = "receipt" | "before" | "after";
type Photo = { kind: Kind; file: File; url: string };

const KIND_LABEL: Record<Kind, string> = { receipt: "Receipt", before: "Before", after: "After" };

const SUGGESTIONS = {
  tenant: ["What's waiting on me?", "Explain my latest bill", "Help me submit a repair claim"],
  landlord: ["What do I need to do?", "Explain the latest invoice", "Send a payment reminder"],
};

// "Ask Aunt Tally": a floating chat panel for one lease. The conversation lives only in this browser
// tab. She can prepare actions, but each one runs only when the person presses the card's button.
export function Assistant({ leaseId, role, firstName }: { leaseId: string; role: "landlord" | "tenant"; firstName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      text: `Hi ${firstName}, I'm ${ASSISTANT.name}, the AI assistant here. I can explain your bill, tell you what's waiting on you, or take care of a claim or payment with you. I'll always ask before I do anything.`,
    },
  ]);
  const [pending, setPending] = useState<Pending | null>(null);
  // `draft`: photos in the tray above the input. `sent`: photos already sent in the chat that no card
  // has used yet; they go along when a card that needs photos is confirmed.
  const [draft, setDraft] = useState<Photo[]>([]);
  const [sent, setSent] = useState<Photo[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending, busy, draft.length]);

  const say = (text: string) => setMessages((m) => [...m, { role: "assistant", text }]);

  async function ask(question: string, history = messages) {
    const photos = history === messages ? draft : [];
    const q = question.trim() || (photos.length ? "Here are my photos." : "");
    if (!q || busy) return;
    const attached = [...sent, ...photos];
    const next: Message[] = [...history, { role: "user", text: q, photos }];
    setMessages(next);
    setInput("");
    setDraft([]);
    setSent(attached);
    setPending(null);
    setBusy(`${ASSISTANT.name} is looking it up…`);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leaseId,
          messages: next.map(({ role, text }) => ({ role, text })),
          attachments: attached.map((p) => ({ kind: p.kind, name: p.file.name })),
        }),
      });
      const reply = (await res.json()) as { text?: string; pending?: Pending; error?: string };
      say(reply.text ?? reply.error ?? "Sorry, something went wrong.");
      setPending(reply.pending ?? null);
    } catch {
      say("Sorry, I couldn't reach the server. Try again?");
    } finally {
      setBusy(null);
    }
  }

  async function confirm() {
    if (!pending || busy) return;
    const card = pending;
    setBusy("Working on it…");
    const form = new FormData();
    form.append("leaseId", leaseId);
    form.append("action", JSON.stringify(card.action));
    if (card.needsPhotos) for (const p of sent) form.append(p.kind, p.file);
    let result: { ok: boolean; error?: string; message?: string; claimId?: string; startReview?: boolean };
    try {
      result = await (await fetch("/api/assistant/act", { method: "POST", body: form })).json();
    } catch {
      result = { ok: false, error: "couldn't reach the server" };
    }
    setPending(null);
    if (!result.ok) {
      say(`✗ That didn't go through: ${result.error}`);
      setBusy(null);
      return;
    }
    if (card.needsPhotos) setSent([]);
    const done = `✓ ${result.message}`;
    say(done);
    router.refresh();
    if (!result.startReview || !result.claimId) {
      setBusy(null);
      return;
    }
    // A new or changed claim: run the review here, then let her report what it found.
    setBusy("Reviewing the evidence and the lease… this takes a minute.");
    await fetch(`/api/claims/${result.claimId}/review`, { method: "POST" }).catch(() => null);
    router.refresh();
    setBusy(null);
    await ask("How did the review go?", [...messages, { role: "assistant", text: done }]);
  }

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    try {
      const resized = await Promise.all([...files].map(resizeImage));
      setDraft((p) => [...p, ...resized.map((file) => ({ kind: (p.length ? "after" : "receipt") as Kind, file, url: URL.createObjectURL(file) }))].slice(0, 12));
    } catch (err) {
      say(err instanceof Error ? err.message : "I couldn't read that photo.");
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] z-30 flex items-center gap-2 rounded-full bg-white py-1.5 pr-4 pl-1.5 text-sm font-medium text-stone-800 shadow-lg ring-1 ring-stone-200 hover:ring-stone-400"
      >
        <AuntTallyAvatar size={36} />
        Ask {ASSISTANT.name}
      </button>
    );
  }

  return (
    <section
      aria-label={`Chat with ${ASSISTANT.name}`}
      className="fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] z-30 flex h-[min(34rem,calc(100dvh-6rem))] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-stone-200"
    >
      <header className="flex items-center gap-2 border-b border-stone-100 px-3 py-2">
        <AuntTallyAvatar size={34} />
        <div className="flex-1 leading-tight">
          <p className="text-sm font-semibold">{ASSISTANT.name}</p>
          <p className="text-xs text-stone-500">{ASSISTANT.disclosure} · asks before doing anything</p>
        </div>
        <button onClick={() => setOpen(false)} aria-label="Close chat" className="grid size-8 place-items-center rounded-full text-stone-500 hover:bg-stone-100">
          ✕
        </button>
      </header>

      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3 text-sm">
        {messages.map((m, i) =>
          m.role === "assistant" ? (
            <div key={i} className="max-w-[90%] rounded-2xl rounded-tl-sm bg-stone-100 px-3 py-2 text-stone-800">
              <RichText text={m.text} />
            </div>
          ) : (
            <div key={i} className="ml-auto max-w-[85%] space-y-2 rounded-2xl rounded-tr-sm bg-stone-900 px-3 py-2 text-white">
              {m.photos && m.photos.length > 0 && (
                <div className="flex flex-wrap justify-end gap-1.5">
                  {m.photos.map((p) => (
                    <figure key={p.url} className="w-16">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.url} alt={p.file.name} className="h-14 w-16 rounded-md object-cover" />
                      <figcaption className="mt-0.5 text-center text-[10px] text-stone-300">{KIND_LABEL[p.kind]}</figcaption>
                    </figure>
                  ))}
                </div>
              )}
              <p>{m.text}</p>
            </div>
          ),
        )}
        {busy && <p className="text-xs text-stone-500">{busy}</p>}
        {pending && (
          <div className="rounded-xl border border-sky-300 bg-sky-50 p-3">
            <p className="font-medium text-sky-900">{pending.title}</p>
            {pending.lines.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-sky-800">
                {pending.lines.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex gap-2">
              <button onClick={confirm} disabled={!!busy} className="rounded-lg bg-[#0070ba] px-3 py-1.5 font-medium text-white hover:bg-[#005ea6] disabled:opacity-50">
                {pending.confirmLabel}
              </button>
              <button onClick={() => setPending(null)} disabled={!!busy} className="rounded-lg px-3 py-1.5 text-stone-700 hover:bg-white">
                Not now
              </button>
            </div>
          </div>
        )}
        {messages.length === 1 && !busy && (
          <div className="flex flex-wrap gap-2 pt-1">
            {SUGGESTIONS[role].map((s) => (
              <button key={s} onClick={() => ask(s)} className="rounded-full border border-stone-300 bg-white px-3 py-1 text-xs text-stone-700 hover:border-stone-500">
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {draft.length > 0 && (
        <div className="flex gap-2 overflow-x-auto border-t border-stone-100 px-2 pt-2">
          {draft.map((p, i) => (
            <div key={p.url} className="relative w-20 shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={p.file.name} className="h-16 w-20 rounded-md object-cover" />
              <button
                onClick={() => {
                  URL.revokeObjectURL(p.url);
                  setDraft((all) => all.filter((_, j) => j !== i));
                }}
                aria-label={`Remove ${p.file.name}`}
                className="absolute top-0.5 right-0.5 grid size-5 place-items-center rounded-full bg-black/60 text-[10px] text-white"
              >
                ✕
              </button>
              <select
                value={p.kind}
                onChange={(e) => setDraft((all) => all.map((q, j) => (j === i ? { ...q, kind: e.target.value as Kind } : q)))}
                aria-label={`What ${p.file.name} shows`}
                className="mt-1 w-full rounded border border-stone-300 bg-white px-1 py-0.5 text-xs"
              >
                {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
        className="flex gap-2 border-t border-stone-100 p-2"
      >
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => addPhotos(e.target.files)} />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={!!busy}
          aria-label="Attach photos"
          title="Attach photos"
          className="grid size-9 shrink-0 place-items-center rounded-lg text-stone-600 hover:bg-stone-100 disabled:opacity-40"
        >
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />
          </svg>
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Ask ${ASSISTANT.name}…`}
          aria-label={`Message ${ASSISTANT.name}`}
          className="flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-stone-900 focus:outline-none"
        />
        <button disabled={!!busy || (!input.trim() && !draft.length)} className="rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-40">
          Send
        </button>
      </form>
    </section>
  );
}

/** Just enough markdown for her replies: paragraphs, "- " bullets, **bold** and [links](/path). */
function RichText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-2">
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        if (lines.every((l) => /^\s*[-*] /.test(l))) {
          return (
            <ul key={i} className="list-disc space-y-1 pl-4">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*[-*] /, ""))}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(l)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*|\[([^\]]+)\]\((\/[^)\s]*)\)/g;
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      m[1] !== undefined ? (
        <strong key={m.index}>{m[1]}</strong>
      ) : (
        <Link key={m.index} href={m[3]} className="font-medium text-sky-800 underline">
          {m[2]}
        </Link>
      ),
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
