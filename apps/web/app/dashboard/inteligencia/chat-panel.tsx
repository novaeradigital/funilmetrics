"use client";

import { useRef, useState } from "react";

type Message = { role: "user" | "assistant"; content: string };

type Props = {
  configured: boolean;
  models: string[];
  defaultModel: string;
  initialMessages: Message[];
  filters: {
    from: string | null;
    to: string | null;
    businessId: string | null;
    accountIds: string[] | null;
  };
  scopeLabel: string;
};

const CHIPS = [
  "O que eu escalo hoje?",
  "Qual criativo está fadigando?",
  "Monte 3 ganchos novos pro criativo X",
  "Que formato me dá mais retorno?",
];

export function InteligenciaChatPanel(props: Props) {
  const [messages, setMessages] = useState<Message[]>(props.initialMessages);
  const [input, setInput] = useState("");
  const [model, setModel] = useState(props.defaultModel);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || sending) return;
    setError(null);
    setSending(true);
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    try {
      const response = await fetch("/dashboard/inteligencia/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          model,
          from: props.filters.from,
          to: props.filters.to,
          businessId: props.filters.businessId,
          accountIds: props.filters.accountIds,
          scopeLabel: props.scopeLabel,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        reply?: string;
        error?: string;
      } | null;
      if (!response.ok || !payload?.reply) {
        throw new Error(payload?.error ?? "Falha ao falar com o chat.");
      }
      setMessages((prev) => [...prev, { role: "assistant", content: payload.reply! }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao falar com o chat.");
    } finally {
      setSending(false);
      requestAnimationFrame(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
      });
    }
  };

  return (
    <section
      className="dashboard-card"
      style={{ display: "flex", flexDirection: "column", gap: 10, height: "100%" }}
    >
      <header className="card-header" style={{ marginBottom: 0 }}>
        <div>
          <p className="panel-label">Chat com IA</p>
          <h2>Pergunte sobre os dados</h2>
        </div>
      </header>
      {!props.configured ? (
        <p>
          O cartão OpenRouter não está configurado em Integrações. Configure a chave e o modelo
          de análise para liberar o chat.
        </p>
      ) : (
        <>
          <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
            Modelo
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {props.models.map((m) => (
                <option key={m} value={m}>
                  {m}
                  {m === props.defaultModel ? " (padrão)" : ""}
                </option>
              ))}
            </select>
          </label>
          <div
            ref={listRef}
            style={{
              flex: 1, overflowY: "auto", display: "grid", gap: 8, alignContent: "start",
              minHeight: 240, maxHeight: 560,
            }}
          >
            {messages.length === 0 ? (
              <p className="metric-footnote">
                Os números que o chat cita são os desta página, nos filtros atuais. Veredito é
                do motor de regras; o chat explica e escreve.
              </p>
            ) : null}
            {messages.map((m, index) => (
              <div
                key={index}
                style={{
                  justifySelf: m.role === "user" ? "end" : "start",
                  maxWidth: "92%",
                  padding: "8px 10px",
                  borderRadius: 10,
                  background: m.role === "user" ? "#2b3444" : "#1f242c",
                  whiteSpace: "pre-wrap",
                  fontSize: 13.5,
                }}
              >
                {m.content}
              </div>
            ))}
            {sending ? <p className="metric-footnote">Pensando...</p> : null}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                style={{ fontSize: 12 }}
                onClick={() => {
                  if (chip.includes("criativo X")) setInput(chip);
                  else void send(chip);
                }}
              >
                {chip}
              </button>
            ))}
          </div>
          {error ? <p style={{ color: "#f87171", margin: 0, fontSize: 13 }}>{error}</p> : null}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
            style={{ display: "flex", gap: 8 }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Pergunte sobre os criativos, campanhas e vereditos..."
              style={{ flex: 1 }}
            />
            <button type="submit" className="button-primary" disabled={sending}>
              Enviar
            </button>
          </form>
        </>
      )}
    </section>
  );
}
