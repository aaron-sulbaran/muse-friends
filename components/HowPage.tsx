import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { HOW_ANCHORS, README_URL, builtCopy, howCopy, loopCopy, museCopy, privacyCopy, protocolCopy, realCopy } from "@/lib/how";
import { HowLoopDiagram } from "./HowLoopDiagram";

function Section({ id, heading, children }: { id: string; heading: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="mt-14 scroll-mt-6">
      <h2 id={`${id}-heading`} className="text-[22px] font-semibold leading-7">
        {heading}
      </h2>
      {children}
    </section>
  );
}

function Lines({ lines }: { lines: readonly string[] }) {
  return (
    <div className="mt-4 space-y-3 text-[16px] leading-6">
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
}

function RealTable() {
  const [realLabel, seededLabel] = realCopy.columns;
  return (
    <>
      {/* On a phone each row is a pair of short blocks, so nothing scrolls sideways and nothing is cut off. */}
      <ul className="mt-4 divide-y divide-bezel-line rounded-group bg-group sm:hidden">
        {realCopy.rows.map(([real, seeded]) => (
          <li key={real} className="px-4 py-3">
            <p className="text-[13px] font-semibold leading-[18px] text-muted">{realLabel}</p>
            <p className="text-[15px] leading-[22px]">{real}</p>
            <p className="mt-2 text-[13px] font-semibold leading-[18px] text-muted">{seededLabel}</p>
            <p className="text-[15px] leading-[22px]">{seeded}</p>
          </li>
        ))}
      </ul>
      <div className="mt-4 hidden overflow-x-auto rounded-group bg-group sm:block">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr>
              {realCopy.columns.map((column) => (
                <th key={column} scope="col" className="w-1/2 px-4 pb-2 pt-3 text-[13px] font-semibold leading-[18px] text-muted">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {realCopy.rows.map(([real, seeded]) => (
              <tr key={real} className="border-t border-bezel-line align-top">
                <td className="px-4 py-3 text-[15px] leading-[22px]">{real}</td>
                <td className="px-4 py-3 text-[15px] leading-[22px]">{seeded}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function PrivacyPanels() {
  return (
    <div className="mt-4 grid gap-3 min-[900px]:grid-cols-3">
      {privacyCopy.panels.map((panel) => (
        <figure key={panel.label} className="flex min-w-0 flex-col rounded-group bg-group p-3">
          <figcaption className="text-[13px] font-semibold leading-[18px]">{panel.label}</figcaption>
          <pre className="mt-2 flex-1 whitespace-pre-wrap break-words font-mono text-[12px] leading-[18px]">{JSON.stringify(panel.json, null, 2)}</pre>
          <p className="mt-2 text-[12px] leading-[18px] text-muted">{panel.caption}</p>
        </figure>
      ))}
    </div>
  );
}

function ProtocolChips() {
  return (
    <div className="mt-4 rounded-group bg-group p-4">
      <ul className="flex flex-wrap gap-2" aria-label="The five message types, in the order a thread uses them">
        {protocolCopy.chips.map((chip) => (
          <li key={chip} className="rounded-full bg-surface px-3 py-1 font-mono text-[13px] leading-5">
            {chip}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[15px] leading-[22px]">{protocolCopy.cap}</p>
      <p className="text-[15px] leading-[22px]">{protocolCopy.model}</p>
    </div>
  );
}

function MusePatterns() {
  return (
    <ul className="mt-5 space-y-3">
      {museCopy.patterns.map((pattern) => (
        <li key={pattern.principle} className="grid gap-4 rounded-group bg-group p-4 min-[560px]:grid-cols-[1fr_240px]">
          <div className="min-w-0">
            <p className="text-[15px] font-semibold leading-[22px]">{pattern.principle}</p>
            <p className="mt-1 text-[15px] leading-[22px] text-muted">{pattern.ours}</p>
            <p className="mt-3 text-[15px] leading-[22px]">{pattern.line}</p>
          </div>
          <div className="flex items-start justify-center">
            {pattern.image ? (
              // A crop of our own screen, a fixed asset in /public/how.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={pattern.image} alt={pattern.alt} width={240} className="h-auto w-[240px] max-w-full rounded-tile bg-surface" loading="lazy" />
            ) : (
              <div className="flex items-end gap-1 rounded-tile bg-surface px-4 pt-3" role="img" aria-label={pattern.alt}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/avatars/sprout-portrait.png" alt="" width={96} height={96} className="size-24 object-contain" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/avatars/mochi-portrait.png" alt="" width={96} height={96} className="size-24 object-contain" />
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** The appendix to the stage: one static column that explains what the demo shows. No store, no model, no client state. */
export function HowPage() {
  return (
    <main className="min-h-dvh bg-screen pb-16 text-ink">
      <div className="mx-auto w-full max-w-[720px] px-4">
        <Link href="/" className="inline-flex items-center gap-1.5 pt-5 text-[13px] leading-[18px] text-muted hover:underline">
          <ArrowLeft className="size-4" strokeWidth={1.75} aria-hidden="true" />
          {howCopy.back}
        </Link>

        <header className="mt-4 flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-card bg-linear-to-b from-surface to-stage-end px-4 py-8 text-center">
          {/* The brand kit's wordmark, a fixed vector asset. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/wordmark/muse-friends-wordmark.svg" alt="Muse Friends" className="h-9 w-auto" />
          <h1 className="text-[32px] font-bold leading-[38px]">{howCopy.title}</h1>
          <p className="text-[15px] leading-[22px] text-muted">{howCopy.subtitle}</p>
          <div className="mt-1 flex items-end gap-3" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/avatars/sprout-portrait.png" alt="" width={64} height={64} className="size-16 -scale-x-100 object-contain" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/avatars/mochi-portrait.png" alt="" width={64} height={64} className="size-16 object-contain" />
          </div>
        </header>

        <Section id={HOW_ANCHORS.loop} heading={loopCopy.heading}>
          <HowLoopDiagram />
          <Lines lines={loopCopy.lines} />
        </Section>

        <Section id={HOW_ANCHORS.real} heading={realCopy.heading}>
          <RealTable />
        </Section>

        <Section id={HOW_ANCHORS.privacy} heading={privacyCopy.heading}>
          <PrivacyPanels />
          <Lines lines={privacyCopy.lines} />
        </Section>

        <Section id={HOW_ANCHORS.protocol} heading={protocolCopy.heading}>
          <ProtocolChips />
          <Lines lines={protocolCopy.lines} />
        </Section>

        <Section id={HOW_ANCHORS.muse} heading={museCopy.heading}>
          <p className="mt-4 text-[16px] leading-6">{museCopy.intro}</p>
          <MusePatterns />
        </Section>

        <Section id={HOW_ANCHORS.built} heading={builtCopy.heading}>
          <div className="mt-4 space-y-3 text-[16px] leading-6">
            {builtCopy.paragraphs.map((paragraph) => (
              <p key={paragraph.lead}>
                <strong className="font-semibold">{paragraph.lead}</strong> {paragraph.text}
              </p>
            ))}
            <p>
              <a href={README_URL} className="font-semibold text-accent-dot hover:underline">
                {howCopy.readme}
              </a>
              .
            </p>
          </div>
        </Section>

        <footer className="mt-14 flex flex-col items-start gap-4 border-t border-bezel-line pt-6">
          <Link href="/" className="rounded-full bg-accent-dot px-5 py-2.5 text-[15px] font-semibold text-surface transition-colors hover:bg-accent">
            {howCopy.seeItLive}
          </Link>
          <p className="text-[13px] leading-[18px] text-muted">{howCopy.footer}</p>
        </footer>
      </div>
    </main>
  );
}
