import { useEffect, useRef, useState } from 'react';

/** Reveals text progressively (typewriter effect). */
function TypeText({ text, animate }) {
  const [shown, setShown] = useState(animate ? 0 : text.length);

  useEffect(() => {
    if (!animate) {
      setShown(text.length);
      return undefined;
    }
    setShown(0);
    const step = Math.max(1, Math.round(text.length / 90));
    const id = setInterval(() => {
      setShown((n) => {
        if (n + step >= text.length) {
          clearInterval(id);
          return text.length;
        }
        return n + step;
      });
    }, 16);
    return () => clearInterval(id);
  }, [text, animate]);

  return (
    <>
      {text.slice(0, shown)}
      {shown < text.length && <span className="caret" />}
    </>
  );
}

const SUGGESTIONS = ['What can you do?', 'Tell me a fun fact', 'Plan my morning routine'];

export default function Conversation({ name, messages, pending, canSpeak, speakingId, onReplay, onSend, busy }) {
  const feedRef = useRef(null);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, pending]);

  const submit = (e) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    onSend(text);
    setDraft('');
  };

  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;
  const empty = messages.length === 0 && !pending;

  return (
    <section className="chat" aria-label="Conversation">
      {empty ? (
        <div className="chat__empty">
          <p>Ask {name} anything, in any language.</p>
          <div className="suggestions">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="suggestion" onClick={() => onSend(s)} disabled={busy}>
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="chat__feed" ref={feedRef}>
          {messages.map((m) => (
            <article key={m.id} className={`bubble bubble--${m.role}`}>
              {m.role === 'assistant' && <span className="bubble__avatar" aria-hidden="true" />}
              <div className="bubble__body">
                <p>
                  {m.role === 'assistant' ? (
                    <TypeText text={m.content} animate={m.id === lastAssistantId && m.fresh} />
                  ) : (
                    m.content
                  )}
                </p>
                <footer>
                  {m.langLabel && <span>{m.langLabel}</span>}
                  {m.role === 'assistant' && canSpeak && (
                    <button
                      type="button"
                      className={`play ${speakingId === m.id ? 'is-on' : ''}`}
                      onClick={() => onReplay(m)}
                    >
                      {speakingId === m.id ? 'Stop' : 'Play'}
                    </button>
                  )}
                </footer>
              </div>
            </article>
          ))}

          {pending && (
            <article className="bubble bubble--assistant bubble--pending">
              <span className="bubble__avatar" aria-hidden="true" />
              <div className="bubble__body">
                <p>
                  <span className="dots">
                    <i />
                    <i />
                    <i />
                  </span>
                  {pending}
                </p>
              </div>
            </article>
          )}
        </div>
      )}

      <form className="composer" onSubmit={submit}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Message ${name}…`}
          aria-label={`Message ${name}`}
          maxLength={4000}
        />
        <button type="submit" className="composer__send" disabled={!draft.trim() || busy} aria-label="Send">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </form>
    </section>
  );
}
