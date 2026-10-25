type BubbleProps = {
  from: "muse" | "user";
  children: React.ReactNode;
};

/** One thought per bubble. Muse's sit left in grey; the person's sit right in blue. */
export function ChatBubble({ from, children }: BubbleProps) {
  const isUser = from === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <p
        className={`max-w-[78%] animate-fade-in rounded-bubble px-3.5 py-2.5 text-[16px] leading-[22px] ${
          isUser ? "bg-bubble-user" : "bg-bubble-muse"
        }`}
      >
        {children}
      </p>
    </div>
  );
}

export function TypingDots() {
  return (
    <div className="flex justify-start" role="status" aria-label="Typing">
      <span className="flex gap-1 rounded-bubble bg-bubble-muse px-4 py-3.5">
        {[0, 1, 2].map((dot) => (
          <span
            key={dot}
            className="size-1.5 animate-typing rounded-full bg-muted"
            style={{ animationDelay: `${dot * 150}ms` }}
          />
        ))}
      </span>
    </div>
  );
}

/** "Today 8:40 PM" with the day word in bold, centered and small. */
export function DaySeparator({ day, time }: { day: string; time: string }) {
  return (
    <p className="text-center text-[12px] leading-[16px] text-muted">
      <span className="font-semibold">{day}</span> {time}
    </p>
  );
}
