import { badRequest, tooLarge, unsupportedMedia } from "./errors.js";

export const MAX_QUESTION_LENGTH = 600;
export const MAX_HISTORY_ITEMS = 6;
export const MAX_HISTORY_LENGTH = 400;
export const MAX_SPEAK_LENGTH = 900; // chunked server-side (Groq TTS caps input at 200 chars)
export const MAX_AUDIO_BYTES = 6 * 1024 * 1024; // stays well under Groq's 25 MB limit

const ROLES = new Set(["user", "assistant"]);

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function validateAsk(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Request body must be a JSON object.");
  }

  const message = asString(body.message);
  if (!message) throw badRequest("A question is required.");
  if (message.length > MAX_QUESTION_LENGTH) {
    throw badRequest(`Questions must be ${MAX_QUESTION_LENGTH} characters or fewer.`);
  }

  let history = [];
  if (body.history !== undefined && body.history !== null) {
    if (!Array.isArray(body.history)) {
      throw badRequest("`history` must be an array.");
    }
    if (body.history.length > MAX_HISTORY_ITEMS) {
      throw badRequest(`History may contain at most ${MAX_HISTORY_ITEMS} messages.`);
    }
    history = body.history.map((item) => {
      if (!item || typeof item !== "object") {
        throw badRequest("Each history item must be an object.");
      }
      const role = typeof item.role === "string" ? item.role : "";
      if (!ROLES.has(role)) throw badRequest("Invalid history role.");
      const content = asString(item.content);
      if (!content) throw badRequest("History items need content.");
      // Truncate long replies instead of rejecting — real answers can exceed
      // the limit and older clients may still send them.
      return {
        role,
        content: content.length > MAX_HISTORY_LENGTH ? content.slice(0, MAX_HISTORY_LENGTH) : content
      };
    });
  }

  return { message, history };
}

export function validateSpeak(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Request body must be a JSON object.");
  }
  const text = asString(body.text);
  if (!text) throw badRequest("Text is required.");
  if (text.length > MAX_SPEAK_LENGTH) {
    throw tooLarge(`Text must be ${MAX_SPEAK_LENGTH} characters or fewer.`);
  }
  return { text };
}

export function validateLanguage(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const language = String(value).trim().toLowerCase();
  if (!/^[a-z]{2}(-[a-z]{2,4})?$/.test(language)) {
    throw badRequest("`language` must be a language code such as `en`.");
  }
  return language;
}

const AUDIO_TYPES = new Set([
  "audio/webm",
  "audio/webm;codecs=opus",
  "audio/ogg",
  "audio/ogg;codecs=opus",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/x-m4a",
  "audio/aac",
  "audio/wav",
  "audio/x-wav",
  "video/webm",
  "video/mp4",
]);

const EXTENSIONS = {
  "audio/webm": "webm",
  "video/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "video/mp4": "mp4",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
};

export function fileFilter(_req, file, cb) {
  const type = (file.mimetype || "").toLowerCase();
  if (AUDIO_TYPES.has(type) || type.startsWith("audio/")) {
    cb(null, true);
    return;
  }
  cb(unsupportedMedia("Please upload an audio recording (webm, mp4, ogg, mp3 or wav)."));
}

export function audioFilename(originalName, mimetype) {
  const type = (mimetype || "").toLowerCase().split(";")[0];
  const ext = EXTENSIONS[type] || "webm";
  const safe = String(originalName || `recording.${ext}`)
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .slice(0, 60);
  return safe.includes(".") ? safe : `${safe}.${ext}`;
}

// Splits a reply into TTS-sized chunks (Groq Orpheus caps input at 200 chars).
export function splitForTts(text, max = 190) {
  const clean = String(text).replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean ? [clean] : [];

  const sentences = clean.split(/(?<=[.!?…])\s+/);
  const chunks = [];
  let current = "";

  const push = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };

  for (const sentence of sentences) {
    if (sentence.length > max) {
      push();
      let remaining = sentence;
      while (remaining.length > max) {
        let cut = remaining.lastIndexOf(" ", max);
        if (cut < 10) cut = max;
        chunks.push(remaining.slice(0, cut).trim());
        remaining = remaining.slice(cut).trim();
      }
      current = remaining;
      continue;
    }
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= max) current = candidate;
    else {
      push();
      current = sentence;
    }
  }
  push();
  return chunks;
}
