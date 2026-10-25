import { AgentId, type MemberId } from "@/lib/protocol";

// Short, sortable, unique-enough ids for demo records.
export function newId(prefix: string, nowMs: number = Date.now()): string {
  const random = Math.random().toString(36).slice(2, 6);
  return `${prefix}_${nowMs.toString(36)}${random}`;
}

// The phone seat of a member, or undefined for the third friend of a group, who has none.
export function seatOf(member: MemberId): AgentId | undefined {
  const seat = AgentId.safeParse(member);
  return seat.success ? seat.data : undefined;
}

// The other seat of a pair. The third friend of a group is always paired with the coordinator, "aaron".
export function otherAgent(agent: MemberId): AgentId {
  return agent === "aaron" ? "lisa" : "aaron";
}
