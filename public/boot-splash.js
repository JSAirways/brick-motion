(() => {
  const toAssetUrl = (fileName) => new URL(`./assets/${fileName}`, window.location.href).toString();
  const images = [
    toAssetUrl("splash_screen_01.jpg"),
    toAssetUrl("splash_screen_02.jpg"),
    toAssetUrl("splash_screen_03.jpg"),
    toAssetUrl("splash_screen_04.jpg"),
    toAssetUrl("splash_screen_05.jpg")
  ];
  const idx = Math.floor(Math.random() * images.length);
  const picked = images[idx] || images[0];
  sessionStorage.setItem("brick-motion.splash-image", picked);
  document.documentElement.style.setProperty("--bm-boot-bg-image", `url("${picked}")`);
  const logo = document.querySelector(".boot-logo");
  if (logo instanceof HTMLImageElement) {
    logo.src = toAssetUrl("logo.jpg");
  }

  const applyBootVersion = (semver) => {
    const versionEl = document.querySelector(".boot-version");
    if (versionEl && semver) {
      versionEl.textContent = `Version ${semver}`;
    }
  };

  try {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", toAssetUrl("app-version.json"), false);
    xhr.send();
    if (xhr.status >= 200 && xhr.status < 300 && xhr.responseText) {
      const data = JSON.parse(xhr.responseText);
      if (data && typeof data.semver === "string") {
        applyBootVersion(data.semver);
      }
    }
  } catch {
    applyBootVersion("0.0.0");
  }
})();
