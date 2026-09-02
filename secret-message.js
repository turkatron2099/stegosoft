(() => {
  const messageInput = document.getElementById("message-input");
  const charCount = document.getElementById("char-count");
  const encryptBtn = document.getElementById("encrypt-btn");
  const resultBox = document.getElementById("result-box");
  const resultLink = document.getElementById("result-link");
  const copyBtn = document.getElementById("copy-btn");
  const copiedNote = document.getElementById("copied-note");

  const composeView = document.getElementById("compose-view");
  const revealView = document.getElementById("reveal-view");
  const revealPrompt = document.getElementById("reveal-prompt");
  const revealBtn = document.getElementById("reveal-btn");
  const revealMessage = document.getElementById("reveal-message");
  const revealMessageText = document.getElementById("reveal-message-text");
  const alreadyViewed = document.getElementById("reveal-already-viewed");
  const revealError = document.getElementById("reveal-error");

  const VIEWED_MARKER = "#viewed";

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

  async function encryptMessage(plaintext) {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertextBuf = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(plaintext)
    );
    const rawKey = new Uint8Array(await crypto.subtle.exportKey("raw", key));
    return ["v1", toBase64Url(iv), toBase64Url(rawKey), toBase64Url(new Uint8Array(ciphertextBuf))].join(".");
  }

  async function decryptFragment(fragment) {
    const parts = fragment.split(".");
    if (parts.length !== 4 || parts[0] !== "v1") throw new Error("Malformed link");
    const iv = fromBase64Url(parts[1]);
    const rawKey = fromBase64Url(parts[2]);
    const ciphertext = fromBase64Url(parts[3]);
    const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["decrypt"]);
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
      const fragment = await encryptMessage(text);
      const url = `${location.origin}${location.pathname}#${fragment}`;
      resultLink.value = url;
      resultBox.hidden = false;
      copiedNote.hidden = true;
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

    revealBtn.addEventListener("click", async () => {
      try {
        const plaintext = await decryptFragment(fragment);
        revealPrompt.hidden = true;
        revealMessageText.textContent = plaintext;
        revealMessage.hidden = false;
        localStorage.setItem(viewedKey, "1");
        // Scrub the key out of the visible address bar / history now that
        // it's been used — it's already served its purpose.
        history.replaceState(null, "", location.pathname + VIEWED_MARKER);
      } catch (err) {
        revealPrompt.hidden = true;
        revealError.hidden = false;
      }
    });
  }

  initReveal();
})();
