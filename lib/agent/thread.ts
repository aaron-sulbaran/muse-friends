import { THREAD_CAP, type AgentMessage, type TaskState, type Window } from "@/lib/protocol";
import { windowHash, windowsOverlap } from "./windows";

// Pure rules for how a thread moves. The model never sets `state`; code does.

export function nextThreadState(candidate: Pick<AgentMessage, "from" | "type" | "windows">, prior: AgentMessage[]): TaskState {
  // A payment thread is two messages: the payment, then the answer (kept or refunded). The answer ends it.
  if (candidate.type === "payment") return "working";
  if (candidate.type === "payment_received") return "completed";
  if (candidate.type === "decline") return "rejected";
  if (candidate.type === "accept") {
    const agreed = candidate.windows?.[0];
    const friendAccepted = prior.some(
      (message) => message.type === "accept" && message.from !== candidate.from && agreed && message.windows?.[0] && windowHash(message.windows[0]) === windowHash(agreed),
    );
    if (friendAccepted) return "input-required";
  }
  return "working";
}

// The sixth message has to close the thread: accept or decline.
export function isForcedClose(seq: number): boolean {
  return seq >= THREAD_CAP;
}

export function closesThread(type: AgentMessage["type"]): boolean {
  return type === "accept" || type === "decline";
}

// Windows from the friend's last message that this reply passed over: none of the reply's windows
// overlap them. They go into the thread's rejected-window ledger.
export function passedOver(friendWindows: Window[] | undefined, replyWindows: Window[] | undefined): Window[] {
  return (friendWindows ?? []).filter((offered) => !(replyWindows ?? []).some((reply) => windowsOverlap(offered, reply)));
}
