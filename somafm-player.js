(function () {
  const STORAGE_KEY = "somafm-playing";
  const CHANNEL_LABEL = "SomaFM — Groove Salad 2";
  // Three mirrors for the same broadcast (ice2/ice6/ice5) — fall back to
  // the next one if a stream endpoint fails to connect.
  const STREAM_URLS = [
    "https://ice2.somafm.com/groovesalad2-256-mp3",
    "https://ice6.somafm.com/groovesalad2-256-mp3",
    "https://ice5.somafm.com/groovesalad2-256-mp3",
  ];
  // A dead/unreachable stream endpoint doesn't reliably fire an 'error' or
  // even a 'play' event — the browser can just quietly give up (loadstart
  // then suspend, nothing else). So connecting is only considered
  // successful once 'playing' actually fires; otherwise this timeout moves
  // on to the next mirror instead of leaving the button hung forever.
  const CONNECT_TIMEOUT_MS = 8000;
  // A connection that goes quiet mid-stream fires nothing useful either —
  // the element just sits there "playing" silence. So playback position is
  // polled, and this many checks in a row without it advancing counts as a
  // dead stream.
  const STALL_CHECK_MS = 5000;
  const STALL_CHECKS = 3;

  const audio = new Audio();
  audio.preload = "none";
  let streamIndex = 0;
  audio.src = STREAM_URLS[streamIndex];
  let connectTimeoutId = null;
  // wantPlaying is the listener's intent (on until they pause it), as
  // opposed to audio.paused, which also flips when the stream dies on its
  // own. hasPlayed marks that the stream has worked at least once on this
  // page, which is what separates "dropped, reconnect" from "never
  // connected, give up".
  let wantPlaying = false;
  let hasPlayed = false;

  const widget = document.createElement("button");
  widget.type = "button";
  widget.className = "somafm-player";

  const icon = document.createElement("span");
  icon.className = "somafm-icon";
  const label = document.createElement("span");
  label.className = "somafm-label";
  label.textContent = CHANNEL_LABEL;

  widget.appendChild(icon);
  widget.appendChild(label);
  document.body.appendChild(widget);

  function render() {
    const playing = !audio.paused;
    icon.textContent = playing ? "⏸" : "▶";
    widget.classList.toggle("is-playing", playing);
    widget.setAttribute("aria-label", (playing ? "Pause " : "Play ") + CHANNEL_LABEL);
  }
  render();

  function clearConnectTimeout() {
    if (connectTimeoutId) {
      clearTimeout(connectTimeoutId);
      connectTimeoutId = null;
    }
  }

  // Cycles to the next mirror; returns false once every mirror's been tried.
  function tryNextStream() {
    streamIndex = (streamIndex + 1) % STREAM_URLS.length;
    if (streamIndex === 0) return false;
    audio.src = STREAM_URLS[streamIndex];
    return true;
  }

  function giveUp() {
    wantPlaying = false;
    clearConnectTimeout();
    audio.pause();
    localStorage.setItem(STORAGE_KEY, "0");
    render();
  }

  function attemptPlay() {
    wantPlaying = true;
    clearConnectTimeout();
    connectTimeoutId = setTimeout(() => {
      if (hasPlayed) {
        reconnect();
      } else if (tryNextStream()) {
        attemptPlay();
      } else {
        giveUp();
      }
    }, CONNECT_TIMEOUT_MS);

    audio.play().catch((err) => {
      // AbortError only means a newer attempt (or a pause) superseded this
      // one. And once the stream has played, a mirror that fails to connect
      // is left for the timeout above to move past, so a network outage
      // gets retried at that pace instead of in a tight loop.
      if (err.name === "AbortError") return;
      if (hasPlayed && err.name !== "NotAllowedError") return;
      wantPlaying = false;
      clearConnectTimeout();
      render();
    });
  }

  // The stream was playing and then died without the listener asking it to
  // (the server closed the connection, the network dropped, the laptop
  // slept). Unlike the first connect this never gives up: it keeps rotating
  // through the mirrors until one plays or the listener hits pause.
  function reconnect() {
    streamIndex = (streamIndex + 1) % STREAM_URLS.length;
    audio.src = STREAM_URLS[streamIndex];
    attemptPlay();
  }

  function recover() {
    // While an attempt is already in flight its connect timeout drives the
    // retry — see the note in attemptPlay.
    if (!wantPlaying || !hasPlayed || connectTimeoutId) return;
    reconnect();
  }

  // Set right before a game cartridge programmatically ducks playback, so
  // the pause listener below knows not to treat it like the user asking for
  // the music to stay off — it should still auto-resume on the next page.
  let ducked = false;

  audio.addEventListener("playing", () => {
    hasPlayed = true;
    clearConnectTimeout();
    localStorage.setItem(STORAGE_KEY, "1");
    render();
  });
  audio.addEventListener("pause", () => {
    // The browser also fires 'pause' when the stream ends by itself. That
    // isn't the listener asking for quiet, so don't record it as one — the
    // 'ended' listener below reconnects.
    if (wantPlaying && audio.ended) return;
    wantPlaying = false;
    clearConnectTimeout();
    if (!ducked) localStorage.setItem(STORAGE_KEY, "0");
    ducked = false;
    render();
  });
  // A live stream has no end, so 'ended' means the server closed the
  // connection, and a mid-stream 'error' means it broke.
  audio.addEventListener("ended", recover);
  audio.addEventListener("error", recover);

  let lastTime = 0;
  let stalledChecks = 0;
  setInterval(() => {
    if (!wantPlaying || !hasPlayed || connectTimeoutId) {
      stalledChecks = 0;
    } else if (audio.currentTime !== lastTime) {
      lastTime = audio.currentTime;
      stalledChecks = 0;
    } else if (++stalledChecks >= STALL_CHECKS) {
      stalledChecks = 0;
      reconnect();
    }
  }, STALL_CHECK_MS);

  widget.addEventListener("click", () => {
    if (audio.paused) {
      attemptPlay();
    } else {
      audio.pause();
    }
  });

  // Autoplay by default on every visit — unless the user has explicitly
  // paused it before (stored "0"), in which case respect that. This can be
  // silently blocked by the browser's autoplay policy on unvisited origins
  // — if so it just stays paused and one click resumes it (and unlocks
  // autoplay for the origin going forward, in browsers that gate it on
  // engagement history).
  if (localStorage.getItem(STORAGE_KEY) !== "0") {
    attemptPlay();
  }

  // Small public hook so other scripts on the page (e.g. games.js, when a
  // cartridge is inserted) can duck this out of the way without needing to
  // know anything about how it works internally.
  window.SomaFMPlayer = {
    pause() {
      if (!audio.paused) {
        ducked = true;
        audio.pause();
      }
    },
  };
})();
