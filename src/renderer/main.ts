import "bootstrap";
import "bootstrap-icons/font/bootstrap-icons.css";
import "./styles/main.scss";
import { renderApp } from "./app/App";

const mountPoint = document.querySelector<HTMLDivElement>("#app");

if (!mountPoint) {
  throw new Error("Missing #app mount point.");
}

renderApp(mountPoint);

const bootSplash = document.querySelector<HTMLDivElement>("#boot-splash");
if (bootSplash) {
  // Keep the boot splash visible until at least one paint has happened
  // to avoid a black flash between HTML shell load and app mount.
  requestAnimationFrame(() => {
    setTimeout(() => {
      bootSplash.remove();
    }, 2000);
  });
}
