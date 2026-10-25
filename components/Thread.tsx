import { endsRun, startsRun, type ThreadLine } from "@/lib/ui/thread";
import { ThreadBubble } from "./ThreadBubble";

/** The thread's lines in order, grouped into runs: 4px between bubbles of a run, 14px between runs. */
export function Thread({ lines }: { lines: ThreadLine[] }) {
  return (
    <div>
      {lines.map((line, index) => {
        const first = startsRun(lines[index - 1], line);
        return (
          <div key={line.id} className={index === 0 ? "" : first ? "mt-3.5" : "mt-1"}>
            <ThreadBubble line={line} showSender={first} showPicture={endsRun(line, lines[index + 1])} />
          </div>
        );
      })}
    </div>
  );
}
