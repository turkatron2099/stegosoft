// Loads the backup script's source into the "View the script" panel the
// first time it's opened, so people can read it before running it.
(() => {
  const details = document.getElementById("backup-source");
  const code = document.getElementById("backup-source-code");
  let loaded = false;

  details.addEventListener("toggle", async () => {
    if (!details.open || loaded) return;
    loaded = true;
    try {
      const response = await fetch("downloads/Thagobyte-Backup.cmd");
      if (!response.ok) throw new Error(response.statusText);
      code.textContent = (await response.text()).replace(/\r\n/g, "\n");
    } catch {
      loaded = false;
      code.textContent = "Couldn't load the script. Download it and open it in Notepad to read it.";
    }
  });
})();
