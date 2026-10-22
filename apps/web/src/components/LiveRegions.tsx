"use client";

import { AlertCircle, Info } from "lucide-react";
import React, {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

export type BannerTone = "neutral" | "error" | "success";

export interface LiveRegionsContextValue {
  statusMessage: string;
  statusTone: BannerTone;
  politeTranscript: string;
  announceStatus: (message: string, tone?: BannerTone) => void;
  clearStatus: () => void;
  setPoliteTranscript: (transcript: string) => void;
}

const LiveRegionsContext = createContext<LiveRegionsContextValue | null>(null);

export function useLiveRegions(): LiveRegionsContextValue {
  const context = useContext(LiveRegionsContext);
  if (!context) {
    throw new Error("useLiveRegions must be used within a LiveRegionsProvider");
  }
  return context;
}

export function LiveRegionsProvider({ children }: { children: ReactNode }) {
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [statusTone, setStatusTone] = useState<BannerTone>("neutral");
  const [politeTranscript, setPoliteTranscript] = useState<string>("");

  const announceStatus = useCallback(
    (message: string, tone: BannerTone = "neutral") => {
      setStatusMessage(message);
      setStatusTone(tone);
    },
    [],
  );

  const clearStatus = useCallback(() => {
    setStatusMessage("");
    setStatusTone("neutral");
  }, []);

  return (
    <LiveRegionsContext.Provider
      value={{
        statusMessage,
        statusTone,
        politeTranscript,
        announceStatus,
        clearStatus,
        setPoliteTranscript,
      }}
    >
      <div className="min-h-screen bg-bg text-text">
        <div className="mx-auto flex min-h-screen w-full max-w-[480px] flex-col px-5 py-6">
          {/* Always-mounted Assertive Status Banner */}
          <div
            role="status"
            aria-live="assertive"
            aria-atomic="true"
            data-testid="assertive-status-banner"
            className={
              statusMessage
                ? statusTone === "error"
                  ? "mb-4 flex items-start gap-3 rounded-card bg-warning-bg p-4 text-sm font-medium text-warning-text shadow-card"
                  : "mb-4 flex items-start gap-3 rounded-card bg-surface-tint p-4 text-sm font-medium text-text shadow-card"
                : "sr-only"
            }
          >
            {statusMessage && (
              <>
                {statusTone === "error" ? (
                  <AlertCircle
                    aria-hidden="true"
                    className="mt-0.5 h-5 w-5 shrink-0 text-warning-text"
                  />
                ) : (
                  <Info
                    aria-hidden="true"
                    className="mt-0.5 h-5 w-5 shrink-0 text-primary-strong"
                  />
                )}
                <span>{statusMessage}</span>
              </>
            )}
          </div>

          {/* Always-mounted Polite Live Transcript Region */}
          <div
            aria-live="polite"
            data-testid="polite-transcript-region"
            className="sr-only"
          >
            {politeTranscript}
          </div>

          {children}
        </div>
      </div>
    </LiveRegionsContext.Provider>
  );
}
