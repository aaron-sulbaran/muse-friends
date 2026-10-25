import type { AgentId } from "@/lib/protocol";

// Short, sortable, unique-enough ids for demo records.
export function newId(prefix: string, nowMs: number = Date.now()): string {
  const random = Math.random().toString(36).slice(2, 6);
  return `${prefix}_${nowMs.toString(36)}${random}`;
}

export function otherAgent(agent: AgentId): AgentId {
  return agent === "aaron" ? "lisa" : "aaron";
}
