import { CalendarClock, Clock, Film } from "lucide-react";
import { copy } from "@/lib/ui/copy";
import { formatWindowFull } from "@/lib/ui/format";
import type { PhoneView } from "@/lib/ui/chat";
import type { Role, UiPlan } from "@/lib/ui/types";
import { MuseAvatar } from "./MuseAvatar";

type Props = {
  plan: UiPlan;
  role: Role;
  view: PhoneView;
  simulatedFriend: boolean;
  /** True while a decision is on its way to the server. */
  pending: boolean;
  onDecide: (choice: "accept" | "decline") => void;
};

function Row({ icon, title, detail }: { icon: React.ReactNode; title: string; detail?: string }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="grid size-9 shrink-0 place-items-center rounded-tile bg-surface text-ink">{icon}</span>
      <div className="min-w-0">
        <p className="text-[15px] font-semibold leading-5">{title}</p>
        {detail ? <p className="text-[13px] leading-[18px] text-muted">{detail}</p> : null}
      </div>
    </div>
  );
}

/** The one approval card per plan, in the checkout-card pattern: a title, a grey reason, grouped rows, two pills. */
export function RecommendationCard({ plan, role, view, simulatedFriend, pending, onDecide }: Props) {
  const reelOwner = role === "a" ? `${view.friendHumanName}'s` : "your";
  return (
    <section
      aria-label={copy.cardTitle(view.museName, view.friendHumanName)}
      className="max-w-[92%] animate-card-in rounded-card bg-surface p-5 shadow-float"
    >
      <div className="flex items-start gap-3">
        <CalendarClock className="mt-0.5 size-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        <h3 className="text-[17px] font-semibold leading-[22px]">{copy.cardTitle(view.museName, view.friendHumanName)}</h3>
      </div>
      <p className="mt-1 text-[13px] leading-[18px] text-muted">{copy.cardReason(reelOwner)}</p>
      <div className="mt-3 rounded-group bg-group px-3">
        <Row
          icon={<Film className="size-5" strokeWidth={1.75} aria-hidden="true" />}
          title={`${plan.activityTitle} from ${reelOwner} reel`}
          detail={plan.place ?? (plan.placeWithheld ? copy.placeKeptPrivate : undefined)}
        />
        {plan.window ? (
          <Row icon={<Clock className="size-5" strokeWidth={1.75} aria-hidden="true" />} title={formatWindowFull(plan.window)} />
        ) : null}
        <div className="flex items-center gap-3 py-2">
          <MuseAvatar agent={view.friend} simulated={simulatedFriend && view.friend === "lisa"} name={view.friendMuseName} size={36} />
          <p className="text-[15px] font-semibold leading-5">{copy.friendSaidYes(view.friendMuseName, view.friendHumanName)}</p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <button
          type="button"
          disabled={pending}
          onClick={() => onDecide("decline")}
          className="rounded-full bg-group px-4 py-2.5 text-[15px] font-semibold transition-colors hover:bg-bubble-muse active:bg-bubble-muse disabled:opacity-50"
        >
          {role === "a" ? copy.declineA : copy.declineB}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => onDecide("accept")}
          className="rounded-full bg-accent px-4 py-2.5 text-[15px] font-semibold text-white transition-[filter] hover:brightness-110 active:brightness-90 disabled:opacity-50"
        >
          {role === "a" ? copy.acceptA : copy.acceptB}
        </button>
      </div>
    </section>
  );
}
