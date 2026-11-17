"""FastAPI server for the Elara React UI.

Run from the project root:
    .venv\\Scripts\\python.exe -m uvicorn backend.server:app --reload --port 8000
"""

import json
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import assistant as elara


@asynccontextmanager
async def lifespan(_app):
    # Warm up DNS/TLS to the voice service so the first reply isn't slow.
    try:
        async for _ in elara.stream_speech("Hi.", "en", 0):
            pass
    except Exception:
        pass
    yield


app = FastAPI(title="Elara API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    history: list = []


def _respond(question, language, history):
    try:
        answer = elara.generate_reply(question, language, history)
    except Exception as error:
        raise HTTPException(502, f"AI service unavailable: {error}") from error
    if not answer:
        raise HTTPException(502, "The assistant returned an empty reply.")
    # Text comes back immediately; the browser then streams the voice
    # from /api/tts so playback starts within a fraction of a second.
    return {
        "question": question,
        "answer": answer,
        "language": language,
        "languageLabel": elara.language_label(language),
    }


@app.get("/api/status")
def status():
    return {
        "name": elara.ASSISTANT_NAME,
        "chatModel": elara.CHAT_MODEL,
        "sttModel": elara.STT_MODEL,
        "voice": elara.EDGE_VOICES["en"],
        "maxHistory": elara.MAX_HISTORY_MESSAGES,
        "defaultSpeed": elara.DEFAULT_SPEED,
    }


# Plain `def` endpoints run in a worker thread, so blocking API calls
# don't stall the server.
@app.post("/api/voice")
def voice(audio: UploadFile = File(...), history: str = Form("[]")):
    audio_bytes = audio.file.read()
    if not audio_bytes:
        raise HTTPException(400, "No audio was recorded.")
    try:
        question, language = elara.transcribe(audio_bytes, audio.filename or "recording.webm")
    except Exception as error:
        raise HTTPException(502, f"Transcription failed: {error}") from error
    if not question:
        raise HTTPException(422, "No speech was detected. Please try again.")
    try:
        history_list = json.loads(history)
    except json.JSONDecodeError:
        history_list = []
    return _respond(question, language, history_list)


@app.post("/api/chat")
def chat(req: ChatRequest):
    text = req.text.strip()
    return _respond(text, elara.guess_language_from_text(text), req.history)


@app.get("/api/tts")
async def tts(
    text: str = Query(..., min_length=1, max_length=3000),
    lang: str = Query("en", max_length=8),
    speed: int = Query(elara.DEFAULT_SPEED, ge=-50, le=100),
):
    if lang not in elara.supported_tts_languages():
        lang = "en"
    return StreamingResponse(
        elara.stream_speech(text, lang, speed),
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-store"},
    )


# Serve the built React app (frontend/dist) when it exists.
_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if _dist.is_dir():
    app.mount("/", StaticFiles(directory=_dist, html=True), name="ui")
