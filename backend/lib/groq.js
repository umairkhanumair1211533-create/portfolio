import Groq from "groq-sdk";
import { SYSTEM_PROMPT } from "../knowledge.js";
import {
  mapProviderError,
  notConfigured,
  upstreamUnavailable,
} from "../middleware/errors.js";

const DEFAULT_CHAT_MODEL = "openai/gpt-oss-120b";
const FALLBACK_CHAT_MODELS = ["openai/gpt-oss-20b", "llama-3.3-70b-versatile"];
const DEFAULT_STT_MODEL = "whisper-large-v3-turbo";
const DEFAULT_TTS_MODEL = "canopylabs/orpheus-v1-english";
const DEFAULT_TTS_VOICE = "troy";

let client;

// Treats empty values and copy-paste placeholders as "not configured yet",
// so the server answers with a safe message instead of a provider auth error.
function readApiKey() {
  const key = (process.env.GROQ_API_KEY || "").trim();
  if (!key) return "";
  if (/^PASTE_YOUR|YOUR_.+_HERE$|^<.*>$|^\{\{.+\}\}$/i.test(key)) return "";
  return key;
}

function getClient() {
  const apiKey = readApiKey();
  if (!apiKey) throw notConfigured();
  if (!client) client = new Groq({ apiKey });
  return client;
}

export function isConfigured() {
  return Boolean(readApiKey());
}

export function speechMode() {
  const mode = (process.env.VOICE_TTS || "groq").toLowerCase();
  if (mode === "browser" || mode === "silent") return mode;
  return "groq";
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function isModelUnavailableError(err) {
  const status = err?.status ?? err?.response?.status;
  const code = String(err?.code || err?.error?.code || "");
  return status === 404 || status === 400 || /model/i.test(code);
}

export async function createReply({ message, history = [] }) {
  const groq = getClient();
  const models = unique([
    (process.env.GROQ_CHAT_MODEL || DEFAULT_CHAT_MODEL).trim(),
    ...FALLBACK_CHAT_MODELS,
  ]);

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
    { role: "user", content: message },
  ];

  let lastError = null;

  for (const model of models) {
    try {
      const completion = await groq.chat.completions.create({
        model,
        messages,
        temperature: 0.35,
        max_completion_tokens: 320,
      });
      const content = completion?.choices?.[0]?.message?.content?.trim();
      if (content) return content;
      lastError = null;
    } catch (err) {
      if (isModelUnavailableError(err)) {
        lastError = err;
        continue;
      }
      throw mapProviderError(err);
    }
  }

  if (lastError) throw mapProviderError(lastError);
  throw upstreamUnavailable("The assistant returned an empty answer.");
}

export async function transcribeAudio({ buffer, filename, contentType, language }) {
  const groq = getClient();
  const model = (process.env.GROQ_STT_MODEL || DEFAULT_STT_MODEL).trim();

  try {
    const file = new File([buffer], filename, {
      type: contentType || "audio/webm",
    });
    const transcription = await groq.audio.transcriptions.create({
      file,
      model,
      response_format: "json",
      ...(language ? { language } : {}),
      temperature: 0,
    });
    return String(transcription?.text || "").trim();
  } catch (err) {
    throw mapProviderError(err);
  }
}

// Groq Orpheus TTS: input max 200 characters, response_format "wav" only.
export async function synthesizeSpeech(text) {
  const groq = getClient();
  const model = (process.env.GROQ_TTS_MODEL || DEFAULT_TTS_MODEL).trim();
  const voice = (process.env.GROQ_TTS_VOICE || DEFAULT_TTS_VOICE).trim();

  try {
    const response = await groq.audio.speech.create({
      model,
      voice,
      input: text,
      response_format: "wav",
    });
    return Buffer.from(await response.arrayBuffer());
  } catch (err) {
    const raw = `${err?.code || ""} ${err?.message || ""}`;
    if (/model_terms_required|terms acceptance/i.test(raw)) {
      console.error(
        "[voice] TTS model needs terms acceptance: https://console.groq.com/playground?model=canopylabs%2Forpheus-v1-english (falling back to browser voice)"
      );
    }
    throw mapProviderError(err, "tts");
  }
}
