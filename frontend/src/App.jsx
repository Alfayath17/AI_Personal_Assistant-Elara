import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AudioEngine } from './audioEngine.js';
import { getStatus, sendText, sendVoice, speechUrl } from './api.js';
import Orb from './components/Orb.jsx';
import Conversation from './components/Conversation.jsx';
import { Navbar, SettingsDrawer, Toast } from './components/Panels.jsx';

const SETTINGS_KEY = 'elara.settings';
const DEFAULT_SETTINGS = { voice: true, autoplay: true, speed: 10 };
const MIN_RECORDING_MS = 450;

const CTA = {
  idle: 'Tap to speak',
  listening: 'Tap to send',
  thinking: 'Thinking…',
  speaking: 'Stop speaking',
};
const BACKDROP_WORD = {
  idle: 'Assistant',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
};

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function useOrbSize() {
  const calc = () => Math.round(Math.max(260, Math.min(560, window.innerWidth - 32, window.innerHeight * 0.62)));
  const [size, setSize] = useState(calc);
  useEffect(() => {
    const onResize = () => setSize(calc());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}

let nextId = 1;

export default function App() {
  const engine = useMemo(() => new AudioEngine(), []);
  const orbSize = useOrbSize();

  const [status, setStatus] = useState('idle'); // idle | listening | thinking | speaking
  const [messages, setMessages] = useState([]);
  const [pending, setPending] = useState('');
  const [settings, setSettings] = useState(loadSettings);
  const [info, setInfo] = useState(null);
  const [online, setOnline] = useState(null);
  const [error, setError] = useState('');
  const [lastMs, setLastMs] = useState(null);
  const [speakingId, setSpeakingId] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Refs so event handlers always read current values.
  const statusRef = useRef(status);
  statusRef.current = status;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const maxHistoryRef = useRef(10);

  const name = info?.name || 'Elara';
  const maxExchanges = (info?.maxHistory || 10) / 2;
  const exchanges = messages.filter((m) => m.role === 'user').length;
  const lastLang = [...messages].reverse().find((m) => m.langLabel)?.langLabel;

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* storage unavailable */
    }
  }, [settings]);

  useEffect(() => {
    getStatus()
      .then((s) => {
        setInfo(s);
        maxHistoryRef.current = s.maxHistory || 10;
        setOnline(true);
      })
      .catch(() => setOnline(false));
  }, []);

  useEffect(() => {
    document.title = `${name} · AI voice assistant`;
  }, [name]);

  const history = () =>
    messagesRef.current.slice(-maxHistoryRef.current).map(({ role, content }) => ({ role, content }));

  const speak = useCallback(
    async (message) => {
      setSpeakingId(message.id);
      setStatus('speaking');
      await engine.play(speechUrl(message.content, message.lang, settingsRef.current.speed));
      setSpeakingId((id) => (id === message.id ? null : id));
      setStatus((s) => (s === 'speaking' ? 'idle' : s));
    },
    [engine]
  );

  const handleReply = useCallback(
    (res, startedAtMs, includeQuestion) => {
      setLastMs(performance.now() - startedAtMs);
      setOnline(true);
      const reply = {
        id: nextId++,
        role: 'assistant',
        content: res.answer,
        lang: res.language,
        langLabel: res.languageLabel,
        fresh: true,
      };
      setMessages((prev) => [
        ...prev.map((m) => (m.fresh ? { ...m, fresh: false } : m)),
        ...(includeQuestion
          ? [{ id: nextId++, role: 'user', content: res.question, langLabel: res.languageLabel }]
          : []),
        reply,
      ]);
      setPending('');
      const s = settingsRef.current;
      if (s.voice && s.autoplay) speak(reply);
      else setStatus('idle');
    },
    [speak]
  );

  const fail = useCallback((err) => {
    setPending('');
    setStatus('idle');
    setError(err.message || String(err));
    if (/backend|fetch|network/i.test(err.message || '')) setOnline(false);
  }, []);

  const startListening = useCallback(async () => {
    engine.stop();
    setSpeakingId(null);
    try {
      await engine.startRecording();
      setStatus('listening');
    } catch (err) {
      setStatus('idle');
      setError(
        err && err.name === 'NotAllowedError'
          ? 'Microphone access was blocked. Allow it from the address bar and try again.'
          : 'No microphone was found, or it could not be opened.'
      );
    }
  }, [engine]);

  const stopListening = useCallback(async () => {
    const result = await engine.stopRecording();
    if (!result || result.durationMs < MIN_RECORDING_MS || result.blob.size === 0) {
      setStatus('idle');
      if (result) setError('That was a little short. Hold to speak, then release.');
      return;
    }
    setStatus('thinking');
    setPending('Listening back…');
    const t0 = performance.now();
    try {
      handleReply(await sendVoice(result.blob, history()), t0, true);
    } catch (err) {
      fail(err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, handleReply, fail]);

  const submitText = async (text) => {
    if (statusRef.current === 'thinking' || statusRef.current === 'listening') return;
    engine.stop();
    setSpeakingId(null);
    const prior = history();
    setMessages((prev) => [
      ...prev.map((m) => (m.fresh ? { ...m, fresh: false } : m)),
      { id: nextId++, role: 'user', content: text },
    ]);
    setStatus('thinking');
    setPending('Thinking…');
    const t0 = performance.now();
    try {
      handleReply(await sendText(text, prior), t0, false);
    } catch (err) {
      fail(err);
    }
  };

  const onPrimary = () => {
    const s = statusRef.current;
    if (s === 'idle') startListening();
    else if (s === 'listening') stopListening();
    else if (s === 'speaking') engine.stop();
  };

  const onReplay = (m) => {
    if (speakingId === m.id) {
      engine.stop();
      return;
    }
    if (statusRef.current === 'thinking' || statusRef.current === 'listening') return;
    speak(m);
  };

  const clearConversation = () => {
    engine.stop();
    setMessages([]);
    setSpeakingId(null);
    setLastMs(null);
  };

  const clearError = useCallback(() => setError(''), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // Keyboard: hold Space to talk, Esc to stop speaking.
  useEffect(() => {
    const typing = (e) => ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(e.target.tagName);
    const down = (e) => {
      if (e.code === 'Escape') engine.stop();
      if (e.code !== 'Space' || e.repeat || typing(e)) return;
      e.preventDefault();
      if (statusRef.current === 'idle' || statusRef.current === 'speaking') startListening();
    };
    const up = (e) => {
      if (e.code !== 'Space' || typing(e)) return;
      e.preventDefault();
      if (statusRef.current === 'listening') stopListening();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [engine, startListening, stopListening]);

  return (
    <div className={`app is-${status}`}>
      <div className="aurora" aria-hidden="true" />

      <Navbar
        name={name}
        status={status}
        online={online}
        language={lastLang}
        onOpenSettings={() => setDrawerOpen(true)}
      />

      <main>
        <section className="hero">
          <h1>
            <span className="hero__line1">Talk to {name},</span>
            <span className="hero__line2">your personal AI assistant</span>
          </h1>
          <button
            type="button"
            className={`cta cta--${status}`}
            onClick={onPrimary}
            disabled={status === 'thinking'}
          >
            {status === 'listening' && <span className="cta__rec" />}
            {CTA[status]}
            {status === 'idle' && (
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
          <p className="hero__hint">or hold <kbd>Space</kbd> to talk</p>
        </section>

        <section className="stage">
          <div className="backdrop" aria-hidden="true">
            <span className="backdrop__top">{name}</span>
            <span className="backdrop__bottom" key={status}>
              {BACKDROP_WORD[status]}
            </span>
          </div>
          <Orb state={status} engine={engine} size={orbSize} onActivate={onPrimary} label={CTA[status]} />
        </section>

        <Conversation
          name={name}
          messages={messages}
          pending={pending}
          canSpeak={settings.voice}
          speakingId={speakingId}
          onReplay={onReplay}
          onSend={submitText}
          busy={status === 'thinking' || status === 'listening'}
        />
      </main>

      <SettingsDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        settings={settings}
        onChange={setSettings}
        onClear={clearConversation}
        canClear={messages.length > 0}
        info={info}
        stats={{ exchanges, maxExchanges, lastMs }}
      />

      <Toast message={error} onClose={clearError} />
    </div>
  );
}
