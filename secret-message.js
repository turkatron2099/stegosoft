(() => {
  const messageInput = document.getElementById("message-input");
  const charCount = document.getElementById("char-count");
  const passwordInput = document.getElementById("password-input");
  const encryptBtn = document.getElementById("encrypt-btn");
  const resultBox = document.getElementById("result-box");
  const resultLink = document.getElementById("result-link");
  const copyBtn = document.getElementById("copy-btn");
  const copiedNote = document.getElementById("copied-note");

  const composeView = document.getElementById("compose-view");
  const revealView = document.getElementById("reveal-view");
  const revealPrompt = document.getElementById("reveal-prompt");
  const revealBtn = document.getElementById("reveal-btn");
  const revealPasswordPrompt = document.getElementById("reveal-password-prompt");
  const revealPasswordInput = document.getElementById("reveal-password-input");
  const revealPasswordBtn = document.getElementById("reveal-password-btn");
  const passwordError = document.getElementById("password-error");
  const revealMessage = document.getElementById("reveal-message");
  const revealMessageText = document.getElementById("reveal-message-text");
  const alreadyViewed = document.getElementById("reveal-already-viewed");
  const revealError = document.getElementById("reveal-error");

  const VIEWED_MARKER = "#viewed";
  const PBKDF2_ITERATIONS = 250000;

  function toBase64Url(bytes) {
    let binary = "";
    bytes.forEach((b) => (binary += String.fromCharCode(b)));
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function fromBase64Url(str) {
    str = str.replace(/-/g, "+").replace(/_/g, "/");
    while (str.length % 4) str += "=";
    const binary = atob(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function sha256Hex(str) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  // Derives an AES-GCM key straight from a password (PBKDF2 + a random
  // salt) instead of a random key of its own — so with a password set, the
  // link never contains anything capable of decrypting the message by
  // itself. extractable:false since nothing should ever need to export it.
  async function deriveKeyFromPassword(password, salt) {
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  // v1: random key embedded whole in the link — whoever has the link can
  // decrypt it. v2: key derived from a password + salt; the link carries
  // only the salt, so the password is also required.
  async function encryptMessage(plaintext, password) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);

    if (password) {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const key = await deriveKeyFromPassword(password, salt);
      const ciphertextBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
      return ["v2", toBase64Url(iv), toBase64Url(salt), toBase64Url(new Uint8Array(ciphertextBuf))].join(".");
    }

    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
    const ciphertextBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
    const rawKey = new Uint8Array(await crypto.subtle.exportKey("raw", key));
    return ["v1", toBase64Url(iv), toBase64Url(rawKey), toBase64Url(new Uint8Array(ciphertextBuf))].join(".");
  }

  async function decryptV1(fragment) {
    const parts = fragment.split(".");
    if (parts.length !== 4) throw new Error("Malformed link");
    const iv = fromBase64Url(parts[1]);
    const rawKey = fromBase64Url(parts[2]);
    const ciphertext = fromBase64Url(parts[3]);
    const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["decrypt"]);
    const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return new TextDecoder().decode(plainBuf);
  }

  async function decryptV2(fragment, password) {
    const parts = fragment.split(".");
    if (parts.length !== 4) throw new Error("Malformed link");
    const iv = fromBase64Url(parts[1]);
    const salt = fromBase64Url(parts[2]);
    const ciphertext = fromBase64Url(parts[3]);
    const key = await deriveKeyFromPassword(password, salt);
    // A wrong password derives a different key entirely — AES-GCM's
    // authentication tag then fails to verify and this throws, rather
    // than silently returning garbage. That's how a wrong-password
    // attempt gets detected at all.
    const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return new TextDecoder().decode(plainBuf);
  }

  // --- compose ---

  messageInput.addEventListener("input", () => {
    charCount.textContent = messageInput.value.length;
  });

  encryptBtn.addEventListener("click", async () => {
    const text = messageInput.value;
    if (!text.trim()) return;

    encryptBtn.disabled = true;
    try {
      const fragment = await encryptMessage(text, passwordInput.value);
      const url = `${location.origin}${location.pathname}#${fragment}`;
      resultLink.value = url;
      resultBox.hidden = false;
      copiedNote.hidden = true;
      passwordInput.value = "";
    } catch (err) {
      console.error(err);
    } finally {
      encryptBtn.disabled = false;
    }
  });

  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(resultLink.value);
    } catch {
      resultLink.select();
      document.execCommand("copy");
    }
    copiedNote.hidden = false;
    setTimeout(() => {
      copiedNote.hidden = true;
    }, 2000);
  });

  // --- reveal ---

  async function initReveal() {
    const hash = location.hash;
    if (!hash || hash.length < 2) return; // no payload — stay in compose mode

    composeView.hidden = true;
    revealView.hidden = false;

    if (hash === VIEWED_MARKER) {
      revealPrompt.hidden = true;
      alreadyViewed.hidden = false;
      return;
    }

    const fragment = hash.slice(1);
    const viewedKey = "stegosoft-secret-viewed:" + (await sha256Hex(fragment));

    if (localStorage.getItem(viewedKey)) {
      revealPrompt.hidden = true;
      alreadyViewed.hidden = false;
      return;
    }

    function completeReveal(plaintext) {
      revealPrompt.hidden = true;
      revealPasswordPrompt.hidden = true;
      revealMessageText.textContent = plaintext;
      revealMessage.hidden = false;
      localStorage.setItem(viewedKey, "1");
      // Scrub the key/salt out of the visible address bar / history now
      // that they've been used — already served their purpose.
      history.replaceState(null, "", location.pathname + VIEWED_MARKER);
    }

    const version = fragment.split(".")[0];

    if (version === "v2") {
      revealPrompt.hidden = true;
      revealPasswordPrompt.hidden = false;

      const attemptUnlock = async () => {
        const password = revealPasswordInput.value;
        passwordError.hidden = true;
        revealPasswordBtn.disabled = true;
        try {
          const plaintext = await decryptV2(fragment, password);
          completeReveal(plaintext);
        } catch (err) {
          // A failed attempt hasn't revealed anything, so let them retry
          // rather than burning the link on a typo.
          passwordError.hidden = false;
          revealPasswordInput.value = "";
          revealPasswordInput.focus();
        } finally {
          revealPasswordBtn.disabled = false;
        }
      };

      revealPasswordBtn.addEventListener("click", attemptUnlock);
      revealPasswordInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") attemptUnlock();
      });
      return;
    }

    revealBtn.addEventListener("click", async () => {
      try {
        const plaintext = await decryptV1(fragment);
        completeReveal(plaintext);
      } catch (err) {
        revealPrompt.hidden = true;
        revealError.hidden = false;
      }
    });
  }

  initReveal();
})();
