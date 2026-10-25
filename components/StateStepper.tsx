import { lifecycleSteps } from "@/lib/ui/tokens";
import type { PlanState, UiPlan } from "@/lib/ui/types";

type StepStatus = "reached" | "current" | "ahead";

function statusesFor(plan: UiPlan | null): StepStatus[] {
  if (!plan) return lifecycleSteps.map(() => "ahead");
  const reachedStates = new Set<PlanState>(plan.history.map((entry) => entry.state));
  let currentIndex = -1;
  lifecycleSteps.forEach((step, index) => {
    if (reachedStates.has(step.state)) currentIndex = index;
  });
  return lifecycleSteps.map((_, index) => {
    if (index === currentIndex) return "current";
    return index < currentIndex ? "reached" : "ahead";
  });
}

/**
 * The plan lifecycle in eight dots. On a dropped plan the line stops where it got to and a red dot says why.
 * Compact (a phone sheet is too narrow for eight labels) names only the step the plan is on.
 */
export function StateStepper({ plan, compact = false }: { plan: UiPlan | null; compact?: boolean }) {
  const statuses = statusesFor(plan);
  const currentLabel = lifecycleSteps[statuses.indexOf("current")]?.label ?? null;
  return (
    <div className="px-1">
      <ol className="relative grid grid-cols-8" aria-label="Plan progress">
        <span aria-hidden="true" className="absolute inset-x-[6.25%] top-[7px] h-0.5 bg-group" />
        {lifecycleSteps.map((step, index) => {
          const status = statuses[index];
          const dot =
            status === "reached"
              ? "bg-tracking"
              : status === "current"
                ? "bg-ink ring-4 ring-ink/15"
                : "bg-faint";
          return (
            <li key={step.state} className="relative flex flex-col items-center gap-1.5" aria-current={status === "current" ? "step" : undefined}>
              <span className={`relative z-10 size-4 rounded-full border-2 border-surface transition-colors duration-200 ${dot}`} />
              <span
                className={`text-center text-[12px] leading-4 ${
                  status === "current" ? "font-semibold text-ink" : status === "reached" ? "text-ink" : "text-faint"
                } ${compact ? "sr-only" : ""}`}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
      {compact && currentLabel ? <p className="mt-2 text-center text-[13px] font-semibold leading-[18px]">{currentLabel}</p> : null}
      {plan?.state === "dropped" ? (
        <p className="mt-2 flex items-center gap-1.5 text-[13px] leading-[18px]">
          <span aria-hidden="true" className="size-2 rounded-full bg-withheld" />
          <span className="font-semibold">Dropped</span>
          {plan.droppedReason ? <span className="text-muted">{plan.droppedReason}</span> : null}
        </p>
      ) : null}
    </div>
  );
}
