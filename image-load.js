// Shared by any tool that needs to load an arbitrary image File into an
// <img> element, including HEIC/HEIF — which no browser except Safari can
// decode natively, so it's converted to PNG client-side via heic2any first.
// Requires heic2any to be loaded first (see anaglyph.html / image-converter.html).
(() => {
  const HEIC_TYPES = new Set(["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]);

  function isHeic(file) {
    if (HEIC_TYPES.has(file.type)) return true;
    return /\.hei[cf]$/i.test(file.name);
  }

  // Resolves to { img, url }. `url` is an object URL the caller should
  // revoke (URL.revokeObjectURL) once it's no longer needed.
  window.loadImageFile = async function loadImageFile(file) {
    let blob = file;
    if (isHeic(file)) {
      if (typeof heic2any !== "function") {
        throw new Error("HEIC support didn't load — check your connection and try again.");
      }
      blob = await heic2any({ blob: file, toType: "image/png" });
      if (Array.isArray(blob)) blob = blob[0]; // multi-frame HEIC — first frame only
    }

    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Couldn't decode that image."));
        image.src = url;
      });
      return { img, url };
    } catch (err) {
      URL.revokeObjectURL(url);
      throw err;
    }
  };

  window.looksLikeImageFile = function looksLikeImageFile(file) {
    return file.type.startsWith("image/") || isHeic(file);
  };
})();
