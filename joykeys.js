// Highlights the download for the visitor's OS, and loads each script's
// source into its "View the script" panel the first time it's opened, so
// people can read it before running it.
(() => {
  const platform = (navigator.userAgentData?.platform || navigator.platform || navigator.userAgent).toLowerCase();
  const os = platform.includes("win") ? "windows" : platform.includes("mac") ? "mac" : platform.includes("linux") ? "linux" : null;
  if (os) {
    document.querySelector(`.jk-download[data-os="${os}"]`)?.classList.add("is-yours");
  }

  for (const details of document.querySelectorAll(".jk-source")) {
    const code = details.querySelector("code");
    let loaded = false;

    details.addEventListener("toggle", async () => {
      if (!details.open || loaded) return;
      loaded = true;
      try {
        const response = await fetch(details.dataset.src);
        if (!response.ok) throw new Error(response.statusText);
        code.textContent = (await response.text()).replace(/\r\n/g, "\n");
      } catch {
        loaded = false;
        code.textContent = "Couldn't load the script. Download it and open it in a text editor to read it.";
      }
    });
  }
})();
