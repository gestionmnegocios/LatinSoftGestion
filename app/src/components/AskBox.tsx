"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Send, Sparkles, Loader2 } from "lucide-react";
import { askCopilotAction } from "@/app/actions";

const SUGGESTIONS = ["¿Qué debo comprar esta semana?", "Muéstrame productos próximos a agotarse", "Genera una compra para 30 días"];

export function AskBox() {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<{ text: string; actions: { label: string; href: string }[] } | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const ask = (question: string) => {
    if (!question.trim()) return;
    setQ(question);
    setError("");
    start(async () => {
      const r = await askCopilotAction(question, []);
      if (r.ok) setAnswer(r.data!); else setError(r.error);
    });
  };
  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center gap-2 font-semibold text-navy-900">
        <Sparkles size={17} className="text-ai" /> Pregúntale a LatinSoft
      </div>
      {!answer && !pending && (
        <div className="space-y-2">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => ask(s)} className="block w-full rounded-lg border border-line-200 bg-surface-50 px-3 py-2 text-left text-[13px] text-ink-700 hover:border-brand-500 hover:bg-brand-50">
              {s}
            </button>
          ))}
        </div>
      )}
      {pending && <div className="flex items-center gap-2 py-6 text-[13px] text-ink-500"><Loader2 size={16} className="animate-spin" /> Analizando datos…</div>}
      {answer && !pending && (
        <div className="max-h-52 overflow-y-auto rounded-lg bg-ai-bg/60 p-3 text-[13px] whitespace-pre-line text-ink-950">
          {answer.text}
          <div className="mt-2 flex flex-wrap gap-2">
            {answer.actions.map((a) => <Link key={a.href} href={a.href} className="btn-ai py-1 text-xs">{a.label}</Link>)}
            <button className="btn-ghost py-1 text-xs" onClick={() => setAnswer(null)}>Otra pregunta</button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      <form className="mt-auto flex gap-2 pt-3" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
        <input className="input" placeholder="Escribe tu pregunta…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn-primary px-3" disabled={pending} aria-label="Enviar"><Send size={15} /></button>
      </form>
    </div>
  );
}
