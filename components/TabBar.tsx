import { LayoutGrid, Lightbulb, MessageCircle, Newspaper, SquareCheck, type LucideIcon } from "lucide-react";

const tabs: ReadonlyArray<{ label: string; icon: LucideIcon; current: boolean }> = [
  { label: "Chat", icon: MessageCircle, current: true },
  { label: "Feed", icon: Newspaper, current: false },
  { label: "Ideas", icon: Lightbulb, current: false },
  { label: "Goals", icon: SquareCheck, current: false },
  { label: "Library", icon: LayoutGrid, current: false },
];

/** Muse's floating tab bar. Tabs we did not build are dimmed and disabled, not faked. */
export function TabBar() {
  return (
    <nav aria-label="Muse" className="absolute inset-x-0 bottom-4 flex justify-center">
      <ul className="flex gap-1 rounded-full bg-tabbar p-1.5 shadow-float">
        {tabs.map(({ label, icon: Icon, current }) => (
          <li key={label}>
            <button
              type="button"
              aria-label={label}
              aria-current={current ? "page" : undefined}
              disabled={!current}
              className={`grid h-10 w-12 place-items-center rounded-full ${current ? "bg-tab-on" : "opacity-35"}`}
            >
              <Icon className="size-[22px]" strokeWidth={1.75} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
