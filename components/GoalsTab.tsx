import { Bell, CalendarCheck, ChevronLeft, Clock, Film, MessageCircle, Repeat, X, type LucideIcon } from "lucide-react";
import type { ComponentType } from "react";
import { copy } from "@/lib/ui/copy";
import { CheckMark } from "./CheckMark";
import { goalDone, goalRowDetail, goalSteps, goalTitle, isTracked, type GoalContext } from "@/lib/ui/goals";
import type { PlanState, UiPlan } from "@/lib/ui/types";

/** A step's icon: a lucide icon, or Muse's blue check mark, which takes the same size props. */
type StepIcon = LucideIcon | ComponentType<{ className?: string; strokeWidth?: number }>;

const stepIcons: Record<PlanState, StepIcon> = {
  detected: Film,
  negotiating: MessageCircle,
  awaiting_humans: Clock,
  confirmed: CheckMark,
  scheduled: CalendarCheck,
  reminded: Bell,
  happened: CheckMark,
  followed_up: Repeat,
  dropped: X,
};

type ListProps = {
  plan: UiPlan | null;
  context: GoalContext;
  onOpen: () => void;
};

/** The Goals tab: the plan, once confirmed, as a Tracking item. */
export function GoalsTab({ plan, context, onOpen }: ListProps) {
  return (
    <div className="px-4 pb-28 pt-3">
      <h2 className="text-[22px] font-semibold leading-7">{copy.goalsTitle}</h2>
      <p className="mt-5 flex items-center gap-2 text-[15px] font-semibold leading-5">
        <span aria-hidden="true" className="size-2 rounded-full bg-tracking" />
        {copy.goalsTracking}
      </p>
      {isTracked(plan) ? (
        <button
          type="button"
          onClick={onOpen}
          className="mt-3 flex w-full animate-card-in items-center gap-3 rounded-card bg-surface p-4 text-left shadow-float transition-colors hover:bg-group"
        >
          {goalDone(plan) ? (
            <CheckMark className="size-5" strokeWidth={2.5} />
          ) : (
            <span aria-hidden="true" className="size-5 shrink-0 rounded-full border-2 border-faint" />
          )}
          <span className={plan.outcome?.result === "didnt" ? "min-w-0 opacity-60" : "min-w-0"}>
            <span className="block text-[15px] font-semibold leading-5">{goalTitle(plan, context.friend)}</span>
            <span className="block text-[13px] leading-[18px] text-muted">{goalRowDetail(plan, context)}</span>
          </span>
        </button>
      ) : (
        <p className="mt-3 text-[15px] leading-5 text-muted">{copy.goalsEmpty(context.friend)}</p>
      )}
    </div>
  );
}

type DetailProps = {
  plan: UiPlan;
  context: GoalContext;
  onBack: () => void;
};

/** One goal: its title, and the lifecycle as a vertical timeline, one step per state reached. */
export function GoalDetail({ plan, context, onBack }: DetailProps) {
  const steps = goalSteps(plan, context);
  return (
    <div className="px-4 pb-28 pt-3">
      <button
        type="button"
        onClick={onBack}
        className="-ml-1 flex items-center gap-1 rounded-full py-1 pr-3 text-[15px] font-semibold transition-colors hover:bg-group"
      >
        <ChevronLeft className="size-5" strokeWidth={1.75} aria-hidden="true" />
        {copy.goalsTitle}
      </button>
      <h2 className="mt-3 text-[22px] font-semibold leading-7">{goalTitle(plan, context.friend)}</h2>
      <p className="mt-6 text-[15px] font-semibold leading-5">{copy.activityTitle}</p>
      <ol className="mt-3">
        {steps.map((step, index) => {
          const last = index === steps.length - 1;
          const Icon: StepIcon = last && goalDone(plan) ? CheckMark : last && plan.outcome?.result === "didnt" ? X : stepIcons[step.state];
          return (
            <li key={`${step.state}-${index}`} className="relative flex gap-3 pb-5 animate-row-in">
              {!last ? <span aria-hidden="true" className="absolute left-[13px] top-8 h-[calc(100%-2rem)] w-0.5 bg-bubble-muse" /> : null}
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-group">
                <Icon className="size-4" strokeWidth={1.75} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="text-[15px] font-semibold leading-5">{step.label}</span>
                  <span className="shrink-0 text-[12px] leading-4 text-muted">{step.time}</span>
                </span>
                <span className="block text-[13px] leading-[18px] text-muted">{step.detail}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
