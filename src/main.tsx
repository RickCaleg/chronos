import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import i18n from "./i18n";
import "./index.css";
import App from "./App";
import { platform } from "@platform";

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

platform.init().then((result) => {
  if (result.ok) {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
    return;
  }
  const key = result.reason === "other-tab" ? "startup.otherTab" : "startup.unsupported";
  root.render(
    <div className="flex h-screen flex-col items-center justify-center gap-2 p-6 text-center">
      <h1 className="text-lg font-semibold">{i18n.t(`${key}Title`)}</h1>
      <p className="max-w-md text-sm text-[var(--color-text-muted)]">{i18n.t(`${key}Body`)}</p>
      {result.detail && <p className="max-w-md font-mono text-xs text-[var(--color-text-muted)]">{result.detail}</p>}
    </div>,
  );
});
