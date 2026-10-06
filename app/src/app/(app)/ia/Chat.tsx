"use client";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bot, Send, User, Loader2 } from "lucide-react";
import { askCopilotAction } from "@/app/actions";

type Msg = { role: "user" | "assistant"; content: string; actions?: { label: string; href: string }[] };

const SUGGESTIONS = [
  "¿Qué debo comprar esta semana?",
  "Muéstrame productos próximos a agotarse",
  "¿Qué productos no se venden hace 90 días?",
  "¿Cuál es mi inventario valorizado?",
  "¿Qué proveedor es más conveniente?",
  "Genera una propuesta de compra para los próximos 30 días",
  "¿Qué productos tienen mayor margen?",
  "Cotiza 30 detergentes para Hotel Central",
];

export function Chat({ initialQuestion }: { initialQuestion?: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [pending, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);
  const asked = useRef(false);
  const router = useRouter();

  const ask = (q: string) => {
    if (!q.trim() || pending) return;
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { role: "user", content: q }]);
    setInput("");
    start(async () => {
      const r = await askCopilotAction(q, history);
      setMessages((m) => [...m, r.ok ? { role: "assistant", content: r.data!.text, actions: r.data!.actions } : { role: "assistant", content: `⚠️ ${r.error}` }]);
      router.refresh();
    });
  };

  useEffect(() => {
    if (initialQuestion && !asked.current) { asked.current = true; ask(initialQuestion); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion]);
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight, behavior: "smooth" }); }, [messages, pending]);

  return (
    <div className="card flex h-[calc(100vh-200px)] min-h-[480px] flex-col">
      <div ref={box} className="flex-1 space-y-4 overflow-y-auto p-5">
        {messages.length === 0 && (
          <div className="py-6 text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-ai-bg text-ai"><Bot size={30} /></div>
            <div className="h2">Pregúntale a LatinSoft</div>
            <p className="mt-1 text-[13px] text-ink-500">Qué tienes, qué puedes vender, qué necesitas comprar y a quién conviene comprárselo.</p>
            <div className="mx-auto mt-5 grid max-w-2xl gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((s) => <button key={s} onClick={() => ask(s)} className="rounded-lg border border-line-200 bg-surface-50 px-3 py-2 text-left text-[13px] hover:border-ai hover:bg-ai-bg">{s}</button>)}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-3 ${m.role === "user" ? "justify-end" : ""}`}>
            {m.role === "assistant" && <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ai-bg text-ai"><Bot size={17} /></div>}
            <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-[13.5px] whitespace-pre-line ${m.role === "user" ? "bg-brand-600 text-white" : "bg-surface-100 text-ink-950"}`}>
              {m.content}
              {m.actions && m.actions.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">{m.actions.map((a) => <Link key={a.href} href={a.href} className="btn-ai py-1.5 text-xs">{a.label}</Link>)}</div>
              )}
            </div>
            {m.role === "user" && <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy-900 text-white"><User size={16} /></div>}
          </div>
        ))}
        {pending && <div className="flex items-center gap-2 text-[13px] text-ink-500"><Loader2 size={15} className="animate-spin" /> Consultando datos del negocio…</div>}
      </div>
      <form className="flex gap-2 border-t border-line-200 p-3" onSubmit={(e) => { e.preventDefault(); ask(input); }}>
        <input className="input" placeholder="Escribe tu pregunta…" value={input} onChange={(e) => setInput(e.target.value)} disabled={pending} />
        <button className="btn-primary px-4" disabled={pending || !input.trim()} aria-label="Enviar"><Send size={15} /></button>
      </form>
    </div>
  );
}
