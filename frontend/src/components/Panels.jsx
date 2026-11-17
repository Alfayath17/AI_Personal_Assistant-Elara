import { useEffect } from 'react';

const STATUS_TEXT = {
  idle: 'Online',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
};

export function Navbar({ name, status, online, language, onOpenSettings }) {
  return (
    <nav className="nav">
      <div className="nav__brand">
        <span className="nav__logo" />
        {name}
      </div>

      <div className="nav__center">
        <span className={`chip chip--${online === false ? 'down' : status}`}>
          <i />
          {online === false ? 'Offline' : STATUS_TEXT[status]}
        </span>
        <span className="chip chip--plain">{language || 'Auto language'}</span>
      </div>

      <button type="button" className="nav__btn" onClick={onOpenSettings}>
        Settings
      </button>
    </nav>
  );
}

function Toggle({ label, hint, checked, onChange, disabled }) {
  return (
    <label className={`toggle ${disabled ? 'is-disabled' : ''}`}>
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="toggle__track" />
    </label>
  );
}

export function SettingsDrawer({ open, onClose, settings, onChange, onClear, canClear, info, stats }) {
  const set = (key) => (value) => onChange({ ...settings, [key]: value });

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const rows = [
    ['Language model', info ? info.chatModel.split('/').pop() : '—'],
    ['Speech engine', info ? info.sttModel : '—'],
    ['Voice', info ? info.voice.replace(/Multilingual|Neural/g, '').replace(/-$/, '') : '—'],
    ['Memory', `${stats.exchanges} / ${stats.maxExchanges} exchanges`],
    ['Last reply', stats.lastMs ? `${(stats.lastMs / 1000).toFixed(1)} s` : '—'],
  ];

  return (
    <>
      <div className={`scrim ${open ? 'is-open' : ''}`} onClick={onClose} aria-hidden="true" />
      <aside className={`drawer ${open ? 'is-open' : ''}`} aria-hidden={!open} aria-label="Settings">
        <header className="drawer__head">
          <h2>Settings</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close settings">
            ×
          </button>
        </header>

        <section className="drawer__section">
          <h3>Voice</h3>
          <Toggle label="Spoken replies" checked={settings.voice} onChange={set('voice')} />
          <Toggle
            label="Auto-play"
            hint="Speak each reply automatically"
            checked={settings.autoplay}
            onChange={set('autoplay')}
            disabled={!settings.voice}
          />
          <label className={`range ${settings.voice ? '' : 'is-disabled'}`}>
            <span className="range__head">
              <span>Speaking speed</span>
              <b>
                {settings.speed > 0 ? '+' : ''}
                {settings.speed}%
              </b>
            </span>
            <input
              type="range"
              min={-20}
              max={50}
              step={5}
              value={settings.speed}
              disabled={!settings.voice}
              onChange={(e) => set('speed')(Number(e.target.value))}
              style={{ '--pct': `${((settings.speed + 20) / 70) * 100}%` }}
            />
          </label>
        </section>

        <section className="drawer__section">
          <h3>System</h3>
          <dl className="stats">
            {rows.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="drawer__section">
          <h3>Shortcuts</h3>
          <ul className="keys">
            <li>
              <kbd>Space</kbd> Hold to talk
            </li>
            <li>
              <kbd>Esc</kbd> Stop speaking
            </li>
          </ul>
        </section>

        <button type="button" className="btn-ghost danger" onClick={onClear} disabled={!canClear}>
          Clear conversation
        </button>
      </aside>
    </>
  );
}

export function Toast({ message, onClose }) {
  useEffect(() => {
    if (!message) return undefined;
    const id = setTimeout(onClose, 7000);
    return () => clearTimeout(id);
  }, [message, onClose]);

  if (!message) return null;
  return (
    <div className="toast" role="alert">
      <span>{message}</span>
      <button type="button" onClick={onClose} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
