(function () {
  "use strict";

  // API origin: same origin by default (server hosts the site).
  // For split hosting, set `window.VOICE_API_BASE = "https://your-backend.up.railway.app"` before this script.
  var API_BASE = (typeof window.VOICE_API_BASE === "string" ? window.VOICE_API_BASE : "").replace(/\/+$/, "");

  var ASK_TIMEOUT = 25000;
  var SPEAK_TIMEOUT = 40000;
  var MAX_RECORD_MS = 15000;
  var MIN_RECORD_MS = 700;
  var MAX_HISTORY = 6;
  var HISTORY_ITEM_MAX = 400; // server cap per history message
  // Once server TTS fails (e.g. Groq model terms not accepted yet), stop
  // calling it for the rest of the session and use browser voice instead.
  var serverVoiceBroken = false;
  // Auto-send: after speech is heard, ~2s of continuous silence ends the
  // recording, transcribes it, and asks the AI — no Stop/Send tap needed.
  var SILENCE_TIMEOUT_MS = 2000;
  var SPEECH_START_RMS = 0.025; // mic RMS treated as speech onset
  var SPEECH_HOLD_RMS = 0.015; // below this a speech burst is considered over
  var LEVEL_TICK_MS = 100;
  var GREETING =
    "Hi! I'm Umair's AI assistant. Ask me about his skills, projects, education, or how to get in touch.";

  var el = {};
  var state = "idle";
  var busy = false;
  var muted = false;
  var greeted = false;
  var history = [];
  var lastQuestion = null;
  var playbackToken = 0;
  var activeAudio = null;

  var mediaStream = null;
  var recorder = null;
  var recordChunks = [];
  var recordStartedAt = 0;
  var listenTicker = null;
  var autoStopTimer = null;
  var errorResetTimer = null;

  var audioContext = null;
  var analyser = null;
  var levelSource = null;
  var levelTicker = null;
  var silenceTimer = null;
  var speechDetected = false;
  var speechActive = false;
  var micStarting = false;

  function $(id) { return document.getElementById(id); }

  function makeError(message, code) {
    var err = new Error(message);
    err.code = code;
    return err;
  }

  // ------------------------------------------------------------------
  // Init
  // ------------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", function () {
    el.launch = $("va-launch");
    el.panel = $("va-panel");
    el.status = $("va-status");
    el.messages = $("va-messages");
    el.suggestions = $("va-suggestions");
    el.state = $("va-state");
    el.stateInd = $("va-state-ind");
    el.stateText = $("va-state-text");
    el.stateAction = $("va-state-action");
    el.form = $("va-form");
    el.text = $("va-text");
    el.mic = $("va-mic");
    el.mute = $("va-mute");
    el.stop = $("va-stop");
    el.close = $("va-close");
    el.privacy = $("va-privacy");
    el.privacyDismiss = $("va-privacy-dismiss");

    if (!el.launch || !el.panel || !el.form) return;

    try {
      muted = localStorage.getItem("va-muted") === "1";
    } catch (e) { muted = false; }

    bindEvents();
    syncMuteButton();
    setState("idle");

    if ("speechSynthesis" in window) {
      try { window.speechSynthesis.getVoices(); } catch (e) { /* ignore */ }
    }
  });

  function bindEvents() {
    el.launch.addEventListener("click", function () {
      if (el.panel.hidden) openPanel();
      else closePanel();
    });
    el.close.addEventListener("click", closePanel);

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !el.panel.hidden) closePanel();
    });

    el.form.addEventListener("submit", function (event) {
      event.preventDefault();
      ask(el.text.value);
    });

    el.mic.addEventListener("click", toggleMic);
    el.mute.addEventListener("click", toggleMute);
    el.stop.addEventListener("click", function () {
      stopSpeaking();
    });

    el.privacyDismiss.addEventListener("click", function () {
      el.privacy.hidden = true;
    });

    el.stateAction.addEventListener("click", function () {
      setState("idle");
      if (lastQuestion) ask(lastQuestion);
      else el.text.focus();
    });

    el.suggestions.addEventListener("click", function (event) {
      var button = event.target.closest ? event.target.closest("button[data-va-question]") : null;
      if (button) ask(button.getAttribute("data-va-question"));
    });
  }

  // ------------------------------------------------------------------
  // Panel open / close
  // ------------------------------------------------------------------
  function openPanel() {
    el.panel.hidden = false;
    window.requestAnimationFrame(function () {
      el.panel.classList.add("is-open");
    });
    el.launch.setAttribute("aria-expanded", "true");
    if (!greeted) {
      greeted = true;
      addMessage("assistant", GREETING);
    }
    window.setTimeout(function () { el.text.focus(); }, 240);
  }

  function closePanel() {
    cancelRecording();
    stopSpeaking();
    el.panel.classList.remove("is-open");
    el.launch.setAttribute("aria-expanded", "false");
    window.setTimeout(function () {
      if (!el.panel.classList.contains("is-open")) el.panel.hidden = true;
    }, 220);
    el.launch.focus();
  }

  // ------------------------------------------------------------------
  // State machine + UI
  // ------------------------------------------------------------------
  function statusLine() {
    if (state === "listening") return "Listening… speak now";
    if (state === "processing") return "Processing your question…";
    if (state === "speaking") return muted ? "Muted" : "Speaking the answer aloud";
    if (state === "error") return "Something went wrong";
    return muted ? "Online · voice replies muted" : "Online · ask about this portfolio";
  }

  function setState(next, detail) {
    state = next;
    el.status.textContent = statusLine();
    el.mic.classList.toggle("is-recording", next === "listening");
    el.mic.setAttribute(
      "aria-label",
      next === "listening" ? "Cancel voice recording" : "Ask with your voice"
    );
    var micIcon = el.mic.querySelector("i");
    if (micIcon) micIcon.className = next === "listening" ? "fas fa-stop" : "fas fa-microphone";
    el.stop.hidden = next !== "speaking";

    if (next === "idle") {
      el.state.hidden = true;
      el.state.className = "va-state";
      el.stateAction.hidden = true;
      return;
    }

    el.state.hidden = false;
    el.state.className = "va-state" + (next === "error" ? " va-state-error" : next === "listening" ? " va-state-listening" : "");
    el.stateAction.hidden = next !== "error";

    if (next === "listening") {
      el.stateInd.innerHTML = '<span class="va-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>';
      el.stateText.textContent = "Listening… 0:00";
      el.stateAction.hidden = true;
    } else if (next === "processing") {
      el.stateInd.innerHTML = '<span class="va-dots" aria-hidden="true"><i></i><i></i><i></i></span>';
      el.stateText.textContent = "Thinking…";
      el.stateAction.hidden = true;
    } else if (next === "speaking") {
      el.stateInd.innerHTML = '<span class="va-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>';
      el.stateText.textContent = "Speaking…";
      el.stateAction.hidden = true;
    } else if (next === "error") {
      el.stateInd.innerHTML = '<i class="fas fa-triangle-exclamation" aria-hidden="true"></i>';
      el.stateText.textContent = detail || "Something went wrong.";
      el.stateAction.textContent = lastQuestion ? "Retry" : "Type instead";
    }
  }

  function refreshError(detail) {
    window.clearTimeout(errorResetTimer);
    setState("error", detail);
    errorResetTimer = window.setTimeout(function () {
      if (state === "error") setState("idle");
    }, 8000);
  }

  // ------------------------------------------------------------------
  // Messages
  // ------------------------------------------------------------------
  function addMessage(role, text) {
    var wrap = document.createElement("div");
    wrap.className = "va-msg va-msg-" + role;

    var avatar = document.createElement("span");
    avatar.className = "va-msg-avatar";
    avatar.setAttribute("aria-hidden", "true");
    var icon = document.createElement("i");
    icon.className =
      role === "user" ? "fas fa-user" : role === "error" ? "fas fa-triangle-exclamation" : "fas fa-robot";
    avatar.appendChild(icon);

    var bubble = document.createElement("p");
    bubble.className = "va-bubble";
    bubble.textContent = text;

    if (role === "user") {
      wrap.appendChild(bubble);
      wrap.appendChild(avatar);
    } else {
      wrap.appendChild(avatar);
      wrap.appendChild(bubble);
    }

    el.messages.appendChild(wrap);
    scrollMessages();
    return wrap;
  }

  function addTyping() {
    var wrap = document.createElement("div");
    wrap.className = "va-msg va-msg-assistant";
    wrap.innerHTML =
      '<span class="va-msg-avatar" aria-hidden="true"><i class="fas fa-robot"></i></span>' +
      '<p class="va-bubble"><span class="va-typing" aria-hidden="true"><i></i><i></i><i></i></span></p>';
    el.messages.appendChild(wrap);
    scrollMessages();
    return wrap;
  }

  function scrollMessages() {
    el.messages.scrollTop = el.messages.scrollHeight;
  }

  function hideSuggestions() {
    if (el.suggestions) el.suggestions.hidden = true;
  }

  // ------------------------------------------------------------------
  // Networking
  // ------------------------------------------------------------------
  async function request(path, options, timeoutMs) {
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = null;
    if (controller) {
      options.signal = controller.signal;
      timer = window.setTimeout(function () { controller.abort(); }, timeoutMs);
    }

    var res;
    try {
      res = await window.fetch(API_BASE + path, options);
    } catch (err) {
      if (timer) window.clearTimeout(timer);
      if (err && err.name === "AbortError") {
        throw makeError("The assistant took too long to respond. Please try again.", "timeout");
      }
      throw makeError(
        "I can't reach the voice assistant server right now. Please check your connection and try again.",
        "network"
      );
    }
    if (timer) window.clearTimeout(timer);

    var data = null;
    try { data = await res.json(); } catch (e) { data = null; }

    if (!res.ok || !data || data.ok === false) {
      var message =
        (data && data.error && data.error.message) ||
        "Something went wrong. Please try again.";
      var error = makeError(message, (data && data.error && data.error.code) || "http_" + res.status);
      error.status = res.status;
      throw error;
    }
    return data;
  }

  function postJSON(path, body, timeoutMs) {
    return request(
      path,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      },
      timeoutMs || ASK_TIMEOUT
    );
  }

  function postForm(path, formData, timeoutMs) {
    return request(path, { method: "POST", body: formData }, timeoutMs || ASK_TIMEOUT);
  }

  function friendlyError(err) {
    var message = (err && err.message) || "";
    if (!message || err.code === "network" || err.code === "timeout") return message || "Something went wrong. Please try again.";
    return message;
  }

  // ------------------------------------------------------------------
  // Ask (typed or transcribed)
  // ------------------------------------------------------------------
  async function ask(raw) {
    var text = (raw || "").trim();
    if (!text || busy) return;

    busy = true;
    stopSpeaking();
    hideSuggestions();
    addMessage("user", text);
    lastQuestion = text;
    // history sent to the server = previous turns only (the server appends the
    // current question itself); stored copies are truncated to the server cap
    var pendingHistory = history.slice(-MAX_HISTORY);
    history.push({ role: "user", content: text.slice(0, HISTORY_ITEM_MAX) });
    if (history.length > MAX_HISTORY * 2) history = history.slice(-MAX_HISTORY * 2);
    el.text.value = "";

    var typing = addTyping();
    setState("processing");

    try {
      var data = await postJSON("/api/voice/ask", {
        message: text,
        history: pendingHistory
      });
      if (typing.parentNode) typing.parentNode.removeChild(typing);
      addMessage("assistant", data.reply);
      history.push({ role: "assistant", content: String(data.reply || "").slice(0, HISTORY_ITEM_MAX) });
      if (history.length > MAX_HISTORY * 2) history = history.slice(-MAX_HISTORY * 2);
      await speakReply(data.reply, data.tts);
    } catch (err) {
      if (typing.parentNode) typing.parentNode.removeChild(typing);
      var message = friendlyError(err);
      addMessage("error", message);
      refreshError(message);
    } finally {
      busy = false;
    }
  }

  // ------------------------------------------------------------------
  // Speaking (server TTS with browser fallback)
  // ------------------------------------------------------------------
  function speakReply(text, mode) {
    return new Promise(function (resolve) {
      if (muted || mode === "silent" || !text) {
        setState("idle");
        resolve();
        return;
      }
      var token = playbackToken;
      setState("speaking");

      function fallback() {
        if (token !== playbackToken) { resolve(); return; }
        Promise.resolve()
          .then(function () { return speakWithBrowser(text); })
          .catch(function () { /* voice engine unavailable — answer stays visible as text */ })
          .then(function () {
            // guarantee the UI never stays stuck in "speaking"
            if (token === playbackToken && state === "speaking") setState("idle");
            resolve();
          });
      }

      if (mode === "browser" || (mode === "groq" && serverVoiceBroken)) {
        fallback();
        return;
      }

      postJSON("/api/voice/speak", { text: text.slice(0, 900) }, SPEAK_TIMEOUT)
        .then(function (data) {
          if (token !== playbackToken) { resolve(); return; }
          if (!data || !Array.isArray(data.audio) || !data.audio.length) {
            serverVoiceBroken = true;
            fallback();
            return;
          }
          playChunks(data.audio, token)
            .then(function () {
              if (token === playbackToken) setState("idle");
              resolve();
            })
            .catch(fallback);
        })
        .catch(function () {
          if (token !== playbackToken) { resolve(); return; }
          serverVoiceBroken = true;
          fallback();
        });
    });
  }

  function playChunks(chunks, token) {
    return new Promise(function (resolve, reject) {
      var index = 0;
      var guard = null;

      function next() {
        if (guard) { window.clearTimeout(guard); guard = null; }
        if (token !== playbackToken || index >= chunks.length) { resolve(); return; }

        var audio = new Audio("data:audio/wav;base64," + chunks[index++]);
        var settled = false;
        activeAudio = audio;

        function finish(handler, value) {
          if (settled) return;
          settled = true;
          if (guard) { window.clearTimeout(guard); guard = null; }
          activeAudio = null;
          handler(value);
        }

        guard = window.setTimeout(function () {
          try { audio.pause(); } catch (e) { /* ignore */ }
          finish(next, undefined);
        }, 30000);

        audio.onended = function () { finish(next, undefined); };
        audio.onerror = function () { finish(reject, new Error("audio error")); };
        audio.play().catch(function () { finish(reject, new Error("autoplay blocked")); });
      }
      next();
    });
  }

  function speakWithBrowser(text) {
    return new Promise(function (resolve) {
      if (!("speechSynthesis" in window) || typeof window.SpeechSynthesisUtterance === "undefined") {
        resolve();
        return;
      }
      var token = playbackToken;
      try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }

      var utterance = new window.SpeechSynthesisUtterance(text);
      utterance.lang = "en-US";
      utterance.rate = 1.03;
      utterance.pitch = 1;

      var voices = [];
      try { voices = window.speechSynthesis.getVoices() || []; } catch (e) { voices = []; }
      var english = voices.filter(function (voice) { return /^en/i.test(voice.lang || ""); });
      var preferred =
        english.filter(function (voice) { return /natural|google|samantha|daniel|zira|female|male/i.test(voice.name || ""); })[0] ||
        english[0];
      if (preferred) {
        try { utterance.voice = preferred; } catch (e) { /* engine rejected the voice object */ }
      }

      var settled = false;
      function done() {
        if (settled) return;
        settled = true;
        if (token === playbackToken) setState("idle");
        resolve();
      }

      utterance.onend = done;
      utterance.onerror = done;
      window.setTimeout(done, Math.min(20000, 4000 + text.length * 70));
      window.speechSynthesis.speak(utterance);
    });
  }

  function stopSpeaking() {
    playbackToken += 1;
    if (activeAudio) {
      try { activeAudio.pause(); activeAudio.currentTime = 0; } catch (e) { /* ignore */ }
      activeAudio = null;
    }
    if ("speechSynthesis" in window) {
      try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    }
    if (state === "speaking") setState("idle");
  }

  // ------------------------------------------------------------------
  // Microphone / recording
  // ------------------------------------------------------------------
  function toggleMic() {
    if (state === "listening") {
      // While listening, the mic button cancels (discards) the recording.
      // Sending happens automatically after ~2s of silence.
      cancelRecording();
      return;
    }
    if (busy || micStarting || state === "processing") return;
    stopSpeaking();
    showPrivacyNotice();

    if (
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia ||
      typeof window.MediaRecorder === "undefined"
    ) {
      voiceUnavailable("Voice input isn't supported in this browser. Please type your question instead.");
      return;
    }

    micStarting = true;
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then(function (stream) {
        micStarting = false;
        // Discard the stream if state changed while the permission prompt was open
        // (panel closed, another recording started, or a question is in flight).
        if (state !== "idle" || busy || !el.panel.classList.contains("is-open")) {
          stream.getTracks().forEach(function (track) { track.stop(); });
          return;
        }
        mediaStream = stream;
        startRecording();
      })
      .catch(function () {
        micStarting = false;
        voiceUnavailable(
          "Microphone access was blocked. Please allow the microphone, or type your question instead."
        );
      });
  }

  function voiceUnavailable(message) {
    el.text.focus();
    refreshError(message);
  }

  function pickMime() {
    if (typeof window.MediaRecorder === "undefined") return "";
    var candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/mp4",
      "audio/m4a"
    ];
    for (var i = 0; i < candidates.length; i++) {
      try {
        if (window.MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
      } catch (e) { /* ignore */ }
    }
    return "";
  }

  function startRecording() {
    var mime = pickMime();
    try {
      recorder = mime ? new window.MediaRecorder(mediaStream, { mimeType: mime }) : new window.MediaRecorder(mediaStream);
    } catch (e) {
      releaseStream();
      voiceUnavailable("Voice recording isn't supported in this browser. Please type your question instead.");
      return;
    }

    recordChunks = [];
    recordStartedAt = Date.now();
    speechDetected = false;
    speechActive = false;
    recorder.ondataavailable = function (event) {
      if (event.data && event.data.size) recordChunks.push(event.data);
    };
    recorder.onstop = onRecorded;
    recorder.start();

    setState("listening");
    startSilenceDetection();
    listenTicker = window.setInterval(function () {
      var seconds = Math.min(MAX_RECORD_MS, Math.round((Date.now() - recordStartedAt) / 1000));
      el.stateText.textContent = "Listening… 0:" + String(seconds).padStart(2, "0");
    }, 300);
    autoStopTimer = window.setTimeout(function () {
      stopRecording();
    }, MAX_RECORD_MS);
  }

  function stopRecording() {
    if (!recorder || recorder.state === "inactive") return;
    window.clearInterval(listenTicker);
    window.clearTimeout(autoStopTimer);
    stopLevelAnalysis();
    try { recorder.stop(); } catch (e) { /* ignore */ }
  }

  function cancelRecording() {
    if (recorder && recorder.state !== "inactive") {
      window.clearInterval(listenTicker);
      window.clearTimeout(autoStopTimer);
      recorder.onstop = null;
      try { recorder.stop(); } catch (e) { /* ignore */ }
    }
    stopLevelAnalysis();
    recorder = null;
    recordChunks = [];
    releaseStream();
    if (state === "listening") setState("idle");
  }

  function releaseStream() {
    if (mediaStream) {
      mediaStream.getTracks().forEach(function (track) { track.stop(); });
      mediaStream = null;
    }
  }

  // ------------------------------------------------------------------
  // Silence detection — auto-stop + auto-send after ~2s of silence
  // ------------------------------------------------------------------
  function startSilenceDetection() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return; // no analyser: manual cancel + 15s cap still work
      audioContext = new Ctx();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0;
      levelSource = audioContext.createMediaStreamSource(mediaStream);
      levelSource.connect(analyser);
      var samples = new Uint8Array(analyser.fftSize);

      levelTicker = window.setInterval(function () {
        if (!analyser || state !== "listening") return;
        analyser.getByteTimeDomainData(samples);
        var sum = 0;
        for (var i = 0; i < samples.length; i++) {
          var value = (samples[i] - 128) / 128;
          sum += value * value;
        }
        var rms = Math.sqrt(sum / samples.length);
        // Hysteresis: speech starts above SPEECH_START_RMS and ends below
        // SPEECH_HOLD_RMS, so brief dips between words don't flicker.
        if (rms >= (speechActive ? SPEECH_HOLD_RMS : SPEECH_START_RMS)) {
          speechActive = true;
          speechDetected = true;
          resetSilenceTimer(); // user is speaking (or started again) — reset the 2s window
        } else {
          speechActive = false; // silence: the running timer counts toward auto-send
        }
      }, LEVEL_TICK_MS);
    } catch (e) {
      stopLevelAnalysis(); // graceful: auto-send off, recording still usable
    }
  }

  function resetSilenceTimer() {
    window.clearTimeout(silenceTimer);
    silenceTimer = window.setTimeout(function () {
      silenceTimer = null;
      if (state === "listening" && !busy) stopRecording(); // auto-stop -> transcribe -> ask
    }, SILENCE_TIMEOUT_MS);
  }

  function stopLevelAnalysis() {
    window.clearInterval(levelTicker);
    levelTicker = null;
    window.clearTimeout(silenceTimer);
    silenceTimer = null;
    analyser = null;
    if (levelSource) {
      try { levelSource.disconnect(); } catch (e) { /* ignore */ }
      levelSource = null;
    }
    if (audioContext) {
      try { audioContext.close(); } catch (e) { /* ignore */ }
      audioContext = null;
    }
  }

  function onRecorded() {
    var duration = Date.now() - recordStartedAt;
    var type = (recorder && recorder.mimeType) || "audio/webm";
    var blob = new Blob(recordChunks, { type: type });
    var heardSpeech = speechDetected;
    recordChunks = [];
    recorder = null;
    releaseStream();

    if (!heardSpeech) {
      // Never upload silence or send an empty message.
      refreshError("I didn't hear anything. Tap the mic and speak, or type your question.");
      return;
    }
    if (duration < MIN_RECORD_MS) {
      refreshError("That was too short to hear. Tap the mic and speak, or type your question.");
      return;
    }
    transcribeAndAsk(blob, type);
  }

  function extensionFor(type) {
    var base = (type || "").split(";")[0];
    if (base === "audio/ogg") return "ogg";
    if (base === "audio/mp4" || base === "video/mp4" || base === "audio/m4a") return "m4a";
    if (base === "audio/mpeg") return "mp3";
    return "webm";
  }

  async function transcribeAndAsk(blob, type) {
    setState("processing");
    var form = new FormData();
    form.append("audio", blob, "recording." + extensionFor(type));

    try {
      var data = await postForm("/api/voice/transcribe", form);
      var text = ((data && data.text) || "").trim();
      if (!text) {
        refreshError("I couldn't catch that. Please try again, or type your question.");
        return;
      }
      // Show recognized speech in the input; ask() renders it as a user bubble.
      try { el.text.value = text; } catch (e) { /* ignore */ }
      await ask(text);
    } catch (err) {
      var message = friendlyError(err);
      addMessage("error", message);
      refreshError(message);
    }
  }

  // ------------------------------------------------------------------
  // Mute / privacy
  // ------------------------------------------------------------------
  function syncMuteButton() {
    el.mute.setAttribute("aria-pressed", String(muted));
    el.mute.setAttribute("aria-label", muted ? "Unmute voice replies" : "Mute voice replies");
    var icon = el.mute.querySelector("i");
    if (icon) icon.className = muted ? "fas fa-volume-mute" : "fas fa-volume-up";
  }

  function toggleMute() {
    muted = !muted;
    try { localStorage.setItem("va-muted", muted ? "1" : "0"); } catch (e) { /* ignore */ }
    syncMuteButton();
    if (muted) stopSpeaking();
    el.status.textContent = statusLine();
  }

  function showPrivacyNotice() {
    if (!el.privacy) return;
    var wasHidden = el.privacy.hidden;
    el.privacy.hidden = false;
    if (wasHidden) {
      el.privacy.classList.add("is-highlight");
      window.setTimeout(function () { el.privacy.classList.remove("is-highlight"); }, 1700);
    }
  }
})();
