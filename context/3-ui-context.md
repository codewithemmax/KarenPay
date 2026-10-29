# KarenPay UI, Accessibility & Design System Context (`context/3-ui-context.md`)

## 1. Product Architecture & UI Purpose

KarenPay consists of `@karenpay/core` (pure TypeScript functions: `checkIntent`, `checkLimits`, `buildReadout`, RFC 8785 canonicalization, and `hashMandate`) and the reference Voice Wallet App (`apps/web` + `apps/api`).
The UI serves as a bridge between two users sharing the experience:

* **Blind & Low-Vision Users:** Navigate a predictable, screen-reader-native linear flow with giant `>= 64px` primary buttons, `aria-live` status banners, and zero visual clutter.

* **Sighted Users & Hackathon Judges:** See the cryptographic proof of `@karenpay/core` in real time via a visual Mandate Node Tree, RFC 8785 hash binding badges, and a hash-chained Audit Log bottom-sheet inspector.

## 2. Non-Negotiable Safety & Data Rules

1. **No Client-Composed Safety Speech:** The frontend NEVER invents or formats its own payment summary for speech synthesis. It speaks ONLY the exact `response.spoken` string returned by `@karenpay/core` (`buildReadout`).

2. **Hard Readout Lock (`readoutRequired: true`):** On `/pay`, the `Approve with Fingerprint or Face` button MUST remain physically and programmatically disabled (`disabled={true}`, `aria-disabled="true"`) until `window.speechSynthesis` finishes speaking `response.spoken` and fires `utterance.onend` cleanly without interruption.

3. **Passkey Terminology:** Never write "Face ID" or copy third-party logos. Always write `"fingerprint or face"` or `"passkey"`.

4. **Fixed Backend Contract:** Do not modify `apps/api`, `packages/core`, database schemas, or API payload shapes.

## 3. Theme: WCAG-Compliant Sunset Palette

One high-contrast light theme using the warm WCAG-calibrated Sunset palette:

| CSS Variable | Hex | Usage & Measured Contrast | 
| ----- | ----- | ----- | 
| `--bg` | `#FFF2E7` | Soft Warm Cream / Alabaster main app background (reduces glare) | 
| `--surface` | `#FFFFFF` | Primary cards, mandate inspector, and contact rows | 
| `--surface-tint` | `#FDD9B5` | Warm Peach for interactive pill fill, notice card background, and secondary buttons | 
| `--text` | `#1F0D09` | Deep Espresso primary text (**16.4:1 AAA** on canvas) | 
| `--text-muted` | `#5C2418` | Deep Terracotta secondary labels, metadata, and `"Coming soon"` text (**9.3:1 AAA**) | 
| `--primary` | `#B82D14` | Contrast-Locked Sunset Red fill for 64px primary buttons, ALWAYS paired with `#FFFFFF` text (**5.6:1 AA**). Never dark text on primary. | 
| `--primary-hover` | `#94210D` | Sunset Red hover/active state with `#FFFFFF` text | 
| `--ink` | `#1F0D09` | Links, icons, and text on light surfaces | 
| `--balance-card` | `#1F0D09` | Deep Espresso surface for `/home` balance card and `/pay` Mandate Node Tree (with white text **16.4:1**, peach `#FDD9B5` **10.2:1**, sun `#FFCC6B` **11.1:1**) | 
| `--sun` | `#FFCC6B` | Progress bar fill, highlights, and avatar circles (with `--text` **11.1:1**) | 
| `--peach` | `#F0C38E` | Avatar circles and caption text on the balance card (with `--text` **10.2:1**) | 
| `--coral` | `#F1AA9B` | Avatar circles and decoration only (with `--text` **8.7:1**) | 
| `--danger` | `#9F1239` | Error and tamper-rejection text on `--bg` (**7.6:1**) or white (**8.0:1**) | 
| `--warning-bg` | `#FEF3C7` | Notice and tamper-demo box background with `#78350F` text (**10.1:1 AAA**) | 
| `--input-border` | `#6B6590` | `2px solid` input and card focusable borders | 
| `--divider` | `#EBDDD0` | Structural card borders and dividers | 
| `--focus-ring` | `#F9C74F` | `3px solid #1F0D09` with `2px` offset | 

## 4. Typography & Numeric Precision (`.num`)

* **Primary Font (`--font-sans`):** `Atkinson Hyperlegible` (400, 700) for clear distinction between `0`, `O`, `1`, `l`, and `I`.

* **Numeric & Hash Font (`--font-num`):** `Inter` or `JetBrains Mono` (500, 700) applied via `.num`:

  ```
  .num {
    font-family: var(--font-num), monospace;
    font-variant-numeric: tabular-nums lining-nums slashed-zero;
    font-feature-settings: "tnum" 1, "lnum" 1, "zero" 1;
  }
  
  ```