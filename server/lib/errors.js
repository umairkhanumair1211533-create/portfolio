export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (message) =>
  new HttpError(400, "invalid_request", message);

export const tooLarge = (message) =>
  new HttpError(413, "payload_too_large", message);

export const unsupportedMedia = (message) =>
  new HttpError(415, "unsupported_media_type", message);

export const notFound = (message) => new HttpError(404, "not_found", message);

export const upstreamUnavailable = (message) =>
  new HttpError(503, "assistant_unavailable", message);

export const notConfigured = () =>
  new HttpError(
    503,
    "not_configured",
    "The voice assistant isn't set up on this server yet. Please try again later."
  );

// Maps provider/SDK failures to safe, user-facing messages.
// Never forwards provider payloads, headers, or credentials to the client.
export function mapProviderError(err, kind = "chat") {
  const status = err?.status ?? err?.response?.status;
  const raw = `${err?.code || ""} ${err?.message || ""}`;

  if (/model_terms_required|model_decommissioned|terms acceptance/i.test(raw)) {
    return new HttpError(
      503,
      kind === "tts" ? "tts_unavailable" : "assistant_unavailable",
      kind === "tts"
        ? "Server voice replies are unavailable right now."
        : "The assistant model is unavailable right now. Please try again later."
    );
  }
  if (status === 401 || status === 403) {
    return new HttpError(
      503,
      "assistant_unavailable",
      "The assistant service is temporarily unavailable. Please try again later."
    );
  }
  if (status === 429) {
    return new HttpError(
      429,
      "rate_limited",
      "The assistant is receiving too many requests right now. Please wait a moment and try again."
    );
  }
  if (status === 400 || status === 413 || status === 415) {
    return new HttpError(
      400,
      "invalid_request",
      "The assistant could not process that request. Please try again."
    );
  }
  if (status === 404) {
    return new HttpError(
      503,
      "assistant_unavailable",
      "The assistant model is unavailable right now. Please try again later."
    );
  }
  return new HttpError(
    503,
    "assistant_unavailable",
    "The assistant hit a temporary problem. Please try again."
  );
}
