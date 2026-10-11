import express, { Router } from "express";
import multer from "multer";

import { HttpError, badRequest, tooLarge } from "../middleware/errors.js";
import {
  asyncHandler,
  notFoundHandler,
  rateLimit,
} from "../middleware/index.js";
import { fileFilter, MAX_AUDIO_BYTES } from "../lib/validate.js";
import * as voice from "../controllers/voiceController.js";

const router = Router();
const jsonBody = (limit) => express.json({ limit, type: "application/json" });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AUDIO_BYTES, files: 1, fields: 4 },
  fileFilter,
});

function uploadAudio(req, res, next) {
  upload.single("audio")(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      return next(tooLarge("That recording is too large (maximum 6 MB)."));
    }
    if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") {
      return next(badRequest("Send exactly one audio recording."));
    }
    if (err instanceof HttpError) return next(err);
    next(badRequest("The recording could not be read."));
  });
}

// Health check is registered before the global limiter (unmetered, same as before).
router.get("/health", voice.health);
router.use(rateLimit({ name: "api-all", windowMs: 60_000, max: 90 }));

// ---------------------------------------------------------------------------
// Voice assistant endpoints (all provider credentials stay on this server)
// ---------------------------------------------------------------------------

router.post(
  "/voice/ask",
  jsonBody("48kb"),
  rateLimit({ name: "ask", windowMs: 60_000, max: 12 }),
  asyncHandler(voice.ask)
);

router.post(
  "/voice/transcribe",
  rateLimit({ name: "transcribe", windowMs: 60_000, max: 8 }),
  uploadAudio,
  asyncHandler(voice.transcribe)
);

router.post(
  "/voice/speak",
  jsonBody("16kb"),
  rateLimit({ name: "speak", windowMs: 60_000, max: 6 }),
  asyncHandler(voice.speak)
);

router.use(notFoundHandler);

export default router;
