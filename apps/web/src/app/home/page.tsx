import React from "react";

export default function HomePlaceholderPage() {
  return (
    <main className="flex flex-1 flex-col justify-center">
      <section className="rounded-card bg-surface p-6 shadow-card">
        <h1 className="text-[28px] font-bold leading-tight text-text">Home</h1>
        <p className="mt-2 text-base text-text-muted">
          Signed in to KarenPay sandbox demo.
        </p>
      </section>
    </main>
  );
}
