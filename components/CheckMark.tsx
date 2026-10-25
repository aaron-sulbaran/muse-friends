import { CHECK_MARK_SRC } from "@/lib/ui/handoff";

/** The green check for an action that has been taken. An img, like the status glyphs, so its draw-in stays isolated. */
export function CheckMark() {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={CHECK_MARK_SRC} alt="" width={16} height={16} className="size-4 shrink-0" />;
}
