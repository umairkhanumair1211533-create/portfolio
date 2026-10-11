import { HttpError, badRequest } from "../middleware/errors.js";
import {
  createReply,
  speechMode,
  synthesizeSpeech,
  transcribeAudio,
} from "../lib/groq.js";
import {
  audioFilename,
  splitForTts,
  validateAsk,
  validateLanguage,
  validateSpeak,
} from "../lib/validate.js";

export function health(_req, res) {
  res.json({ ok: true, service: "portfolio-voice-api", tts: speechMode() });
}

export async function ask(req, res) {
  const { message, history } = validateAsk(req.body);
  const reply = await createReply({ message, history });
  res.json({ ok: true, reply, tts: speechMode() });
}

export async function transcribe(req, res) {
  if (!req.file) throw badRequest("An audio recording is required.");
  const language = validateLanguage(req.body?.language);
  const text = await transcribeAudio({
    buffer: req.file.buffer,
    filename: audioFilename(req.file.originalname, req.file.mimetype),
    contentType: req.file.mimetype,
    language,
  });
  res.json({ ok: true, text });
}

export async function speak(req, res) {
  if (speechMode() !== "groq") {
    throw new HttpError(503, "tts_unavailable", "Server text-to-speech is off.");
  }
  const { text } = validateSpeak(req.body);
  const chunks = splitForTts(text, 190);
  if (!chunks.length) throw badRequest("Text is required.");

  const audio = [];
  for (const chunk of chunks) {
    const wav = await synthesizeSpeech(chunk);
    audio.push(wav.toString("base64"));
  }
  res.json({ ok: true, provider: "groq", format: "wav", audio });
}
