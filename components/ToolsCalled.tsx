import { copy } from "@/lib/ui/copy";
import type { UiToolCall } from "@/lib/ui/types";

/** The tools the model call used, in order: what each was called with and what it returned, one line apiece. */
export function ToolsCalled({ calls }: { calls: UiToolCall[] }) {
  return (
    <div className="mt-3 border-t border-bezel-line pt-2.5 font-sans">
      <h4 className="text-[12px] font-semibold leading-4 text-muted">{copy.drawerToolsCalled}</h4>
      <ol className="mt-1.5 flex flex-col gap-2">
        {calls.map((call, index) => (
          <li key={`${call.name}-${index}`} className="text-[12px] leading-[17px]">
            <p className="break-words font-mono">
              <span className="font-semibold">{call.name}</span>
              {call.args ? <span className="text-muted"> {call.args}</span> : null}
            </p>
            {call.result ? (
              <p className="break-words text-muted">
                {copy.drawerToolReturned} <span className="font-mono text-ink">{call.result}</span>
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
