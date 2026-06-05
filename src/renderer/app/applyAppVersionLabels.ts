import { formatAboutVersionLines } from "../../shared/appInfo";

/** Fills About / footer version nodes after route HTML is mounted. */
export const applyAppVersionLabels = (root: ParentNode): void => {
  void window.brickMotion
    .getAppInfo()
    .then((info) => {
      const lines = formatAboutVersionLines(info);
      const startEl = root.querySelector<HTMLElement>("#startAppVersionDetail");
      const releaseEl = root.querySelector<HTMLElement>("#aboutReleaseVersion");
      const schemaEl = root.querySelector<HTMLElement>("#aboutProjectFileFormat");
      if (startEl) {
        startEl.textContent = lines.release;
      }
      if (releaseEl) {
        releaseEl.textContent = lines.release;
      }
      if (schemaEl) {
        schemaEl.textContent = lines.projectFileFormat;
      }
    })
    .catch(() => {
      /* non-fatal */
    });
};
