import type { PolicyStamp as Stamp } from "@/lib/ui/format";

function Pill({ tone, children }: { tone: "shared" | "withheld"; children: React.ReactNode }) {
  const dot = tone === "shared" ? "bg-tracking" : "bg-withheld";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-group px-2.5 py-1 text-[12px] leading-4">
      <span aria-hidden="true" className={`size-1.5 rounded-full ${dot}`} />
      {children}
    </span>
  );
}

/** What policy let through and what it took out. Never omitted: a message that shared nothing says "Shared: nothing". */
export function PolicyStamp({ stamp, animateWithheld }: { stamp: Stamp; animateWithheld: boolean }) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      <Pill tone="shared">Shared: {stamp.shared}</Pill>
      {stamp.withheld ? (
        <span className={animateWithheld ? "animate-fade-in [animation-delay:200ms]" : undefined}>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-group px-2.5 py-1 text-[12px] leading-4">
            <span
              aria-hidden="true"
              className={`size-1.5 rounded-full bg-withheld ${animateWithheld ? "animate-dot-pulse [animation-delay:200ms]" : ""}`}
            />
            Withheld: {stamp.withheld}
          </span>
        </span>
      ) : null}
    </div>
  );
}
