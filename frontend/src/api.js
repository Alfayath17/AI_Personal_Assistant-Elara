async function parse(res) {
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    const detail = data && typeof data.detail === 'string' ? data.detail : null;
    throw new Error(detail || `Server error (${res.status}). Is the backend running?`);
  }
  return data;
}

export async function getStatus() {
  return parse(await fetch('/api/status'));
}

export async function sendVoice(blob, history) {
  const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm';
  const form = new FormData();
  form.append('audio', blob, `recording.${ext}`);
  form.append('history', JSON.stringify(history));
  return parse(await fetch('/api/voice', { method: 'POST', body: form }));
}

export async function sendText(text, history) {
  return parse(
    await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, history }),
    })
  );
}

/** URL that streams the spoken reply as MP3 (playback starts immediately). */
export function speechUrl(text, lang, speed) {
  const q = new URLSearchParams({ text: text.slice(0, 3000), lang: lang || 'en', speed: String(speed) });
  return `/api/tts?${q}`;
}
