import { LayoutGrid, Lightbulb, MessageCircle, Newspaper, SquareCheck, type LucideIcon } from "lucide-react";

export type Tab = "chat" | "goals";

const tabs: ReadonlyArray<{ label: string; icon: LucideIcon; id: Tab | null }> = [
  { label: "Chat", icon: MessageCircle, id: "chat" },
  { label: "Feed", icon: Newspaper, id: null },
  { label: "Ideas", icon: Lightbulb, id: null },
  { label: "Goals", icon: SquareCheck, id: "goals" },
  { label: "Library", icon: LayoutGrid, id: null },
];

type Props = { tab: Tab; onSelect: (tab: Tab) => void };

/** Muse's floating tab bar. Chat and Goals work; the tabs we did not build are dimmed and disabled, not faked. */
export function TabBar({ tab, onSelect }: Props) {
  return (
    <nav aria-label="Muse" className="absolute inset-x-0 bottom-4 z-10 flex justify-center">
      <ul className="flex gap-1 rounded-full bg-tabbar p-1.5 shadow-float">
        {tabs.map(({ label, icon: Icon, id }) => (
          <li key={label}>
            <button
              type="button"
              aria-label={label}
              aria-current={id === tab ? "page" : undefined}
              disabled={id === null}
              onClick={id ? () => onSelect(id) : undefined}
              className={`grid h-10 w-12 place-items-center rounded-full transition-colors ${id === tab ? "bg-tab-on" : ""} ${
                id === null ? "opacity-35" : id === tab ? "" : "hover:bg-tab-on/60"
              }`}
            >
              <Icon className="size-[22px]" strokeWidth={1.75} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
