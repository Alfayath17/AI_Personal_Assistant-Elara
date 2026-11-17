"""Core Elara logic: speech-to-text, AI reply, and streaming neural voice."""

import os
from io import BytesIO
from pathlib import Path

import edge_tts
from dotenv import load_dotenv
from groq import Groq
from gtts import gTTS
from gtts.lang import tts_langs

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

CHAT_MODEL = "openai/gpt-oss-120b"
STT_MODEL = "whisper-large-v3-turbo"
MAX_HISTORY_MESSAGES = 10  # last 5 question/answer pairs

ASSISTANT_NAME = "Elara"
USER_NAME = ""  # optional: your name, so Elara can greet you personally
DEFAULT_SPEED = 10  # percent faster than the voice's natural pace

# Whisper reports languages by name; map to codes used by the voices.
LANGUAGE_NAME_TO_CODE = {
    "english": "en", "tamil": "ta", "hindi": "hi", "telugu": "te",
    "malayalam": "ml", "kannada": "kn", "bengali": "bn", "marathi": "mr",
    "gujarati": "gu", "urdu": "ur", "punjabi": "pa", "arabic": "ar",
    "french": "fr", "spanish": "es", "german": "de", "italian": "it",
    "portuguese": "pt", "russian": "ru", "japanese": "ja", "korean": "ko",
    "chinese": "zh-CN",
}

# Microsoft neural voices (edge-tts): natural female voice per language.
EDGE_VOICES = {
    # en-US-AvaNeural: same natural voice as Ava Multilingual but starts
    # ~3x faster (measured ~0.8 s vs ~2.3 s to first audio).
    "en": "en-US-AvaNeural", "ta": "ta-IN-PallaviNeural",
    "hi": "hi-IN-SwaraNeural", "te": "te-IN-ShrutiNeural",
    "ml": "ml-IN-SobhanaNeural", "kn": "kn-IN-SapnaNeural",
    "bn": "bn-IN-TanishaaNeural", "mr": "mr-IN-AarohiNeural",
    "gu": "gu-IN-DhwaniNeural", "ur": "ur-PK-UzmaNeural",
    "ar": "ar-SA-ZariyahNeural", "fr": "fr-FR-DeniseNeural",
    "es": "es-ES-ElviraNeural", "de": "de-DE-AmalaNeural",
    "it": "it-IT-ElsaNeural", "pt": "pt-BR-FranciscaNeural",
    "ru": "ru-RU-SvetlanaNeural", "ja": "ja-JP-NanamiNeural",
    "ko": "ko-KR-SunHiNeural", "zh-CN": "zh-CN-XiaoxiaoNeural",
}

# Unicode script ranges used to guess the language of TYPED text.
SCRIPT_RANGES = [
    (0x0B80, 0x0BFF, "ta"), (0x0900, 0x097F, "hi"), (0x0C00, 0x0C7F, "te"),
    (0x0C80, 0x0CFF, "kn"), (0x0D00, 0x0D7F, "ml"), (0x0980, 0x09FF, "bn"),
    (0x0A80, 0x0AFF, "gu"), (0x0A00, 0x0A7F, "pa"), (0x0600, 0x06FF, "ar"),
    (0x3040, 0x30FF, "ja"), (0xAC00, 0xD7AF, "ko"), (0x4E00, 0x9FFF, "zh-CN"),
]

_client = None
_tts_langs = None


def get_client():
    global _client
    if _client is None:
        key = os.getenv("GROQ_API_KEY")
        if not key:
            raise RuntimeError("GROQ_API_KEY was not found in the .env file.")
        _client = Groq(api_key=key)
    return _client


def supported_tts_languages():
    global _tts_langs
    if _tts_langs is None:
        _tts_langs = tts_langs()
    return _tts_langs


def to_language_code(detected):
    """Whisper language name/code -> supported voice code (default English)."""
    if not detected:
        return "en"
    value = detected.strip().lower()
    code = LANGUAGE_NAME_TO_CODE.get(value, value)
    return code if code in supported_tts_languages() else "en"


def language_label(code):
    return supported_tts_languages().get(code, code)


def guess_language_from_text(text):
    """Best-effort language guess for typed input, by writing script."""
    for ch in text:
        cp = ord(ch)
        for start, end, code in SCRIPT_RANGES:
            if start <= cp <= end:
                return code
    return "en"


def transcribe(audio_bytes, filename):
    result = get_client().audio.transcriptions.create(
        file=(filename, audio_bytes),
        model=STT_MODEL,
        response_format="verbose_json",
        temperature=0.0,
    )
    text = (getattr(result, "text", "") or "").strip()
    return text, to_language_code(getattr(result, "language", None))


def clean_history(history):
    """Keep only well-formed user/assistant turns, newest last."""
    cleaned = [
        {"role": m["role"], "content": str(m["content"])[:4000]}
        for m in history or []
        if isinstance(m, dict)
        and m.get("role") in ("user", "assistant")
        and m.get("content")
    ]
    return cleaned[-MAX_HISTORY_MESSAGES:]


def generate_reply(question, language_code, history):
    who = f"The user's name is {USER_NAME}; use it occasionally. " if USER_NAME else ""
    system_prompt = (
        f"You are {ASSISTANT_NAME}, a brilliant personal AI voice assistant. "
        "Your personality is warm, upbeat, quick-witted and genuinely helpful, "
        "like a smart friend who always knows the answer. "
        f"{who}"
        "Get straight to the point: answer in one to three short sentences "
        "unless asked for detail. Never ramble or repeat the question. "
        "Your answer will be read aloud, so do not use markdown, "
        "bullet symbols, tables, or emojis. "
        f"The user is speaking {language_label(language_code)}. "
        "Always reply in the same language the user used."
    )
    completion = get_client().chat.completions.create(
        messages=[
            {"role": "system", "content": system_prompt},
            *clean_history(history),
            {"role": "user", "content": question},
        ],
        model=CHAT_MODEL,
        temperature=0.4,
        max_tokens=1024,  # gpt-oss reasons internally; leave headroom
        reasoning_effort="low",
    )
    return (completion.choices[0].message.content or "").strip()


async def stream_speech(text, language_code, speed_percent):
    """Yield MP3 chunks as soon as they are generated (low latency).

    Falls back to gTTS if the neural voice fails before producing audio.
    """
    voice = EDGE_VOICES.get(language_code)
    sent_any = False
    if voice:
        try:
            communicate = edge_tts.Communicate(text, voice, rate=f"{speed_percent:+d}%")
            async for chunk in communicate.stream():
                if chunk["type"] == "audio" and chunk["data"]:
                    sent_any = True
                    yield chunk["data"]
        except Exception:
            if sent_any:
                return  # partial audio already playing; stop cleanly
    if not sent_any:
        buffer = BytesIO()
        gTTS(text=text, lang=language_code).write_to_fp(buffer)
        yield buffer.getvalue()
