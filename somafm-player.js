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

  const audio = new Audio();
  audio.preload = "none";
  let streamIndex = 0;
  audio.src = STREAM_URLS[streamIndex];
  let connectTimeoutId = null;

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
    clearConnectTimeout();
    audio.pause();
    localStorage.setItem(STORAGE_KEY, "0");
    render();
  }

  function attemptPlay() {
    clearConnectTimeout();
    connectTimeoutId = setTimeout(() => {
      if (tryNextStream()) {
        attemptPlay();
      } else {
        giveUp();
      }
    }, CONNECT_TIMEOUT_MS);

    audio.play().catch(() => {
      clearConnectTimeout();
      render();
    });
  }

  // Set right before a game cartridge programmatically ducks playback, so
  // the pause listener below knows not to treat it like the user asking for
  // the music to stay off — it should still auto-resume on the next page.
  let ducked = false;

  audio.addEventListener("playing", () => {
    clearConnectTimeout();
    localStorage.setItem(STORAGE_KEY, "1");
    render();
  });
  audio.addEventListener("pause", () => {
    clearConnectTimeout();
    if (!ducked) localStorage.setItem(STORAGE_KEY, "0");
    ducked = false;
    render();
  });

  widget.addEventListener("click", () => {
    if (audio.paused) {
      attemptPlay();
    } else {
      audio.pause();
    }
  });

  // Landing on a fresh page: try to pick back up where it left off. This
  // can be silently blocked by the browser's autoplay policy — if so it
  // just stays paused and one click resumes it.
  if (localStorage.getItem(STORAGE_KEY) === "1") {
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
