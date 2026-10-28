"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { AuntTallyAvatar } from "@/app/components/aunt-tally";
import { ASSISTANT } from "@/lib/persona";

type Message = { role: "user" | "assistant"; text: string };
type Pending = { type: "send_reminder"; invoiceId: string; month: string; amount: string; note: string };

const SUGGESTIONS = {
  tenant: ["Explain my latest bill", "What's waiting on me?", "Has my last invoice been paid?"],
  landlord: ["What do I need to do?", "Explain the latest invoice", "Send a payment reminder"],
};

// "Ask Aunt Tally": a floating chat panel for one lease. The conversation lives only in this browser
// tab; Aunt Tally can't change anything, and a reminder is sent only after the landlord confirms.
export function Assistant({ leaseId, role, firstName }: { leaseId: string; role: "landlord" | "tenant"; firstName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      text: `Hi ${firstName}, I'm ${ASSISTANT.name}, the AI assistant here. I can explain your bill line by line, tell you what's waiting on you, or check an invoice in PayPal.`,
    },
  ]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending, busy]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    const next: Message[] = [...messages, { role: "user", text: q }];
    setMessages(next);
    setInput("");
    setPending(null);
    setBusy(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leaseId, messages: next }),
      });
      const reply = (await res.json()) as { text?: string; pending?: Pending; error?: string };
      setMessages((m) => [...m, { role: "assistant", text: reply.text ?? reply.error ?? "Sorry, something went wrong." }]);
      setPending(reply.pending ?? null);
    } catch {
      setMessages((m) => [...m, { role: "assistant", text: "Sorry, I couldn't reach the server. Try again?" }]);
    } finally {
      setBusy(false);
    }
  }

  async function confirmReminder() {
    if (!pending) return;
    setBusy(true);
    const res = await fetch("/api/assistant/reminder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leaseId, invoiceId: pending.invoiceId, note: pending.note }),
    });
    const result = (await res.json()) as { ok: boolean; error?: string };
    setMessages((m) => [
      ...m,
      {
        role: "assistant",
        text: result.ok ? `Done. PayPal sent the ${pending.month} reminder, and it's in the activity log.` : `PayPal didn't send it: ${result.error}`,
      },
    ]);
    setPending(null);
    setBusy(false);
    if (result.ok) router.refresh();
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
          <p className="text-xs text-stone-500">{ASSISTANT.disclosure} · can&apos;t change your claims or money</p>
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
            <div key={i} className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-stone-900 px-3 py-2 text-white">
              {m.text}
            </div>
          ),
        )}
        {busy && <p className="text-xs text-stone-500">{ASSISTANT.name} is looking it up…</p>}
        {pending && (
          <div className="rounded-xl border border-sky-300 bg-sky-50 p-3">
            <p className="font-medium text-sky-900">Send a PayPal reminder for the {pending.month} invoice ({pending.amount})?</p>
            <p className="mt-1 text-sky-800">&ldquo;{pending.note}&rdquo;</p>
            <div className="mt-2 flex gap-2">
              <button onClick={confirmReminder} disabled={busy} className="rounded-lg bg-[#0070ba] px-3 py-1.5 text-white hover:bg-[#005ea6] disabled:opacity-50">
                Confirm and send
              </button>
              <button onClick={() => setPending(null)} disabled={busy} className="rounded-lg px-3 py-1.5 text-stone-700 hover:bg-white">
                Cancel
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

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
        className="flex gap-2 border-t border-stone-100 p-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Ask ${ASSISTANT.name}…`}
          aria-label={`Message ${ASSISTANT.name}`}
          className="flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-stone-900 focus:outline-none"
        />
        <button disabled={busy || !input.trim()} className="rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-40">
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
