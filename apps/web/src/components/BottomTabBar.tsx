"use client";

import { History, House, Mic, User } from "lucide-react";
import Link from "next/link";
import React from "react";

export type MainTabKey = "home" | "pay" | "activity" | "me";

export interface BottomTabBarProps {
  activeTab: MainTabKey;
}

const TABS: ReadonlyArray<{
  key: MainTabKey;
  label: string;
  href: string;
}> = [
  { key: "home", label: "Home", href: "/home" },
  { key: "pay", label: "Voice pay", href: "/pay" },
  { key: "activity", label: "Activity", href: "/activity" },
  { key: "me", label: "Me", href: "/me" },
];

export function BottomTabBar({ activeTab }: BottomTabBarProps) {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-divider bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto flex w-full max-w-[480px] items-center justify-around gap-2 px-3 py-2">
        {TABS.map((tab) => {
          const isCurrent = tab.key === activeTab;
          return (
            <Link
              key={tab.key}
              href={tab.href}
              aria-current={isCurrent ? "page" : undefined}
              className="flex min-h-[52px] min-w-[64px] flex-1 flex-col items-center justify-center gap-1 rounded-input px-2 py-1.5 text-sm transition-colors hover:bg-surface-tint"
            >
              <span
                aria-hidden="true"
                className={`flex h-7 w-12 items-center justify-center rounded-full ${
                  isCurrent
                    ? "bg-surface-tint text-ink"
                    : tab.key === "pay"
                      ? "bg-primary text-text"
                      : "text-text-muted"
                }`}
              >
                {tab.key === "home" && (
                  <House aria-hidden="true" className="h-5 w-5 shrink-0" />
                )}
                {tab.key === "pay" && (
                  <Mic aria-hidden="true" className="h-5 w-5 shrink-0" />
                )}
                {tab.key === "activity" && (
                  <History aria-hidden="true" className="h-5 w-5 shrink-0" />
                )}
                {tab.key === "me" && (
                  <User aria-hidden="true" className="h-5 w-5 shrink-0" />
                )}
              </span>
              <span
                className={
                  isCurrent
                    ? "font-bold text-ink"
                    : "font-medium text-text-muted"
                }
              >
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
