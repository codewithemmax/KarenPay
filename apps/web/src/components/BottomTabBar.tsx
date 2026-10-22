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
  emphasize?: boolean;
}> = [
  { key: "home", label: "Home", href: "/home" },
  { key: "pay", label: "Voice pay", href: "/pay", emphasize: true },
  { key: "activity", label: "Activity", href: "/activity" },
  { key: "me", label: "Me", href: "/me" },
];

export function BottomTabBar({ activeTab }: BottomTabBarProps) {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-divider bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm"
    >
      <div className="mx-auto flex w-full max-w-[480px] items-center justify-around gap-2 px-3 py-2">
        {TABS.map((tab) => {
          const isCurrent = tab.key === activeTab;
          return (
            <Link
              key={tab.key}
              href={tab.href}
              aria-current={isCurrent ? "page" : undefined}
              className={`flex min-h-[52px] min-w-[64px] flex-1 flex-col items-center justify-center gap-1 rounded-input px-2 py-1.5 text-sm font-medium transition-colors ${
                isCurrent
                  ? "bg-surface-tint font-semibold text-text"
                  : "text-text-muted hover:bg-surface-tint hover:text-text"
              }`}
            >
              {tab.key === "home" && (
                <House aria-hidden="true" className="h-5 w-5 shrink-0" />
              )}
              {tab.key === "pay" && (
                <span
                  aria-hidden="true"
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-white"
                >
                  <Mic aria-hidden="true" className="h-4 w-4 shrink-0" />
                </span>
              )}
              {tab.key === "activity" && (
                <History aria-hidden="true" className="h-5 w-5 shrink-0" />
              )}
              {tab.key === "me" && (
                <User aria-hidden="true" className="h-5 w-5 shrink-0" />
              )}
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
