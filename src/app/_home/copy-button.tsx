"use client";
// Copies a fixed string to the clipboard. The text is a prop set by the page, never user input. If the
// clipboard is unavailable (old browser, no permission) the button says so and the text stays selectable.
import { useEffect, useState } from "react";
import { Icon } from "./icons";
import s from "./home.module.css";

type State = "idle" | "copied" | "failed";

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<State>("idle");

  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 1800);
    return () => clearTimeout(timer);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  return (
    <button type="button" className={s.copy} onClick={copy} aria-label={label}>
      <Icon name={state === "copied" ? "check" : "copy"} className={s.copyIcon} />
      <span aria-live="polite">{state === "copied" ? "Copied" : state === "failed" ? "Select and copy" : "Copy"}</span>
    </button>
  );
}
