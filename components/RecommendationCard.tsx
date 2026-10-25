import { CalendarClock, Clock, Film } from "lucide-react";
import { copy } from "@/lib/ui/copy";
import { formatWindowFull, reelRowTitle } from "@/lib/ui/format";
import type { GroupView, PhoneView } from "@/lib/ui/chat";
import type { Decision, Role, UiPlan } from "@/lib/ui/types";
import { MuseAvatar } from "./MuseAvatar";

type Props = {
  plan: UiPlan;
  role: Role;
  view: PhoneView;
  simulatedFriend: boolean;
  /** True while a decision is on its way to the server. */
  pending: boolean;
  onDecide: (choice: "accept" | "decline") => void;
  /** "That time doesn't work for me": marks the window busy and plans again. */
  onReplan: () => void;
  error: string | null;
};

function Row({ icon, title, detail }: { icon: React.ReactNode; title: string; detail?: string }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="grid size-9 shrink-0 place-items-center rounded-tile bg-surface text-ink">{icon}</span>
      <div className="min-w-0">
        <p className="text-[15px] font-semibold leading-5">{title}</p>
        {detail ? <p className="text-[15px] leading-5 text-muted">{detail}</p> : null}
      </div>
    </div>
  );
}

const decisionWords: Record<Decision, string> = { pending: copy.groupWaiting, accepted: copy.groupSaidYes, declined: copy.groupSaidNo };

/** Who is in a plan for three and what each has said; every Muse already agreed, the people are the ones still deciding. */
function WhoIsIn({ group, simulatedFriend }: { group: GroupView; simulatedFriend: boolean }) {
  return (
    <div className="py-2">
      <p className="text-[13px] leading-[18px] text-muted">{copy.groupMusesAgreed}</p>
      <ul className="mt-1.5 flex flex-col gap-1.5">
        {group.members.map((member) => (
          <li key={member.id} className="flex items-center gap-3">
            <MuseAvatar agent={member.id} simulated={simulatedFriend && member.id === "lisa"} name={member.name} size={28} />
            <p className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-5">
              {member.name}
              {member.you ? <span className="font-normal text-muted"> ({copy.groupYou})</span> : null}
            </p>
            <span className={`shrink-0 text-[13px] leading-[18px] ${member.decision === "accepted" ? "font-semibold text-tracking" : "text-muted"}`}>
              {decisionWords[member.decision]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The one approval card per plan, in the checkout-card pattern: a title, a grey reason, grouped rows, two pills. */
export function RecommendationCard({ plan, role, view, simulatedFriend, pending, onDecide, onReplan, error }: Props) {
  const reelOwner = role === "a" ? `${view.friendHumanName}'s` : "your";
  const group = view.group;
  const title = !group
    ? copy.cardTitle(view.museName, view.friendHumanName)
    : group.coordinator
      ? copy.groupCardTitleA(view.museName, group.others[0].name, group.others[1].name)
      : copy.groupCardTitleMember(group.coordinatorName, group.others.find((other) => other.name !== group.coordinatorName)?.name ?? group.others[0].name);
  return (
    <section aria-label={title} className="max-w-[92%] animate-card-in rounded-card bg-surface p-5 shadow-float">
      <div className="flex items-start gap-3">
        <CalendarClock className="mt-0.5 size-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        <h3 className="text-[17px] font-semibold leading-[22px]">{title}</h3>
      </div>
      <p className="mt-1 text-[13px] leading-[18px] text-muted">{group ? copy.groupCardReason(reelOwner) : copy.cardReason(reelOwner)}</p>
      <div className="mt-3 rounded-group bg-group px-3">
        <Row
          icon={<Film className="size-5" strokeWidth={1.75} aria-hidden="true" />}
          title={reelRowTitle(plan.activityTitle, reelOwner)}
          detail={plan.place ?? (plan.placeWithheld ? copy.placeKeptPrivate : undefined)}
        />
        {plan.window ? (
          <Row icon={<Clock className="size-5" strokeWidth={1.75} aria-hidden="true" />} title={formatWindowFull(plan.window)} />
        ) : null}
        {group ? (
          <WhoIsIn group={group} simulatedFriend={simulatedFriend} />
        ) : (
          <div className="flex items-center gap-3 py-2">
            <MuseAvatar agent={view.friend} simulated={simulatedFriend && view.friend === "lisa"} name={view.friendMuseName} size={36} />
            <p className="text-[15px] leading-5">{copy.friendIsIn(view.friendMuseName)}</p>
          </div>
        )}
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
      {group ? null : (
        <button
          type="button"
          disabled={pending}
          onClick={onReplan}
          className="mt-2 w-full rounded-full px-3 py-2 text-[13px] font-semibold text-muted transition-colors hover:bg-group disabled:opacity-50"
        >
          {copy.cardReplan}
        </button>
      )}
      {error ? (
        <p role="alert" className="mt-1 text-center text-[13px] leading-[18px] text-withheld">
          {error}
        </p>
      ) : null}
    </section>
  );
}
