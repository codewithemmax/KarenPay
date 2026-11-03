"use client";

import { Ear, Eye } from "lucide-react";
import React, { useEffect, useState } from "react";

export const VOICE_ONLY_MODE_STORAGE_KEY = "kp_voice_only_mode";
const VOICE_MODE_EVENT = "karenpay:voice-mode-change";

function readVoiceMode(): boolean {
  try {
    return window.localStorage.getItem(VOICE_ONLY_MODE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function setVoiceOnlyMode(enabled: boolean): void {
  try {
    window.localStorage.setItem(
      VOICE_ONLY_MODE_STORAGE_KEY,
      enabled ? "true" : "false",
    );
  } catch {
    // The preference is optional; the current session still receives the change.
  }
  window.dispatchEvent(new CustomEvent<boolean>(VOICE_MODE_EVENT, { detail: enabled }));
}

export function useVoiceOnlyMode(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useState<boolean>(false);

  useEffect(() => {
    const sync = (event?: Event) => {
      const customEvent = event as CustomEvent<boolean> | undefined;
      setEnabled(typeof customEvent?.detail === "boolean" ? customEvent.detail : readVoiceMode());
    };
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener(VOICE_MODE_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(VOICE_MODE_EVENT, sync);
    };
  }, []);

  return [enabled, setVoiceOnlyMode];
}

export function VoiceModeToggle(): React.JSX.Element {
  const [enabled, setEnabled] = useVoiceOnlyMode();

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={() => setEnabled(!enabled)}
      className="inline-flex min-h-[48px] items-center gap-2 rounded-full border border-divider bg-surface px-4 py-2 text-left text-sm font-bold text-text shadow-card transition-colors hover:bg-surface-tint"
    >
      {enabled ? (
        <Ear className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
      ) : (
        <Eye className="h-5 w-5 shrink-0 text-text-muted" aria-hidden="true" />
      )}
      <span>{enabled ? "Voice-only mode on" : "Use voice-only mode"}</span>
    </button>
  );
}
