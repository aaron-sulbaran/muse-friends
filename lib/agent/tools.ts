import { z } from "zod";
import { SendToFriendArgs, SharedCategory, type ActivityEvent, type Signal } from "@/lib/protocol";
import type { ToolDefinition, ToolHandler } from "@/lib/model";
import { getPersona, displayName } from "@/lib/seed/fixtures";
import type { AgentRuntimeContext } from "./context";
import { ownCalendar, ownFreeBlocks } from "./calendar";
import { newId } from "./ids";
import { sendToFriend } from "./outbox";
import { describeWindow, parseWhen, toCentralIso } from "./windows";

const MODEL_NAME = "muse-spark-1.3";

function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const converted = z.toJSONSchema(schema, { target: "draft-07" }) as Record<string, unknown>;
  delete converted.$schema;
  return converted;
}

const CalendarArgs = z.strictObject({ start: z.string().min(1), end: z.string().min(1) });
const InterestsArgs = z.strictObject({ category: SharedCategory.optional() });
const ReadSignalArgs = z.strictObject({ signal_id: z.string().optional() });
const ReelDetailsArgs = z.strictObject({
  place: z.string().min(1).max(80),
  area: z.string().max(80).optional(),
  cuisine: z.string().max(40).optional(),
  hours: z.string().max(80).optional(),
});

function badArgs(error: z.ZodError) {
  return { error: `Invalid arguments. ${z.prettifyError(error)}` };
}

export function buildTools(ctx: AgentRuntimeContext): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const { store, agent } = ctx;
  const nowMs = () => ctx.wallNow?.() ?? Date.now();

  const tools: ToolDefinition[] = [
    {
      name: "get_my_calendar",
      description: "Your person's calendar between two times: free blocks you may offer and busy blocks. Times are US Central.",
      parameters: jsonSchema(CalendarArgs.describe("start and end as ISO 8601, for example 2026-10-26T00:00:00-05:00")),
    },
    {
      name: "get_interests",
      description: "Your person's interests, optionally for one category (food, events, location, interests).",
      parameters: jsonSchema(InterestsArgs),
    },
    {
      name: "read_signal",
      description: "Read the reel and message your person just received.",
      parameters: jsonSchema(ReadSignalArgs),
    },
    {
      name: "record_reel_details",
      description: "Save the place, area, cuisine, and opening hours you read from the reel caption.",
      parameters: jsonSchema(ReelDetailsArgs),
    },
    {
      name: "send_to_friend_agent",
      description: "Send one structured message to your friend's agent. It is checked and filtered by your person's sharing settings before it goes out.",
      parameters: jsonSchema(SendToFriendArgs),
    },
  ];

  const handlers: Record<string, ToolHandler> = {
    get_my_calendar: async (raw) => {
      const parsed = CalendarArgs.safeParse(raw);
      if (!parsed.success) return badArgs(parsed.error);
      const start = parseWhen(parsed.data.start);
      const end = parseWhen(parsed.data.end);
      if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return { error: "start and end must be ISO 8601 times with end after start." };
      const range = { start: toCentralIso(start), end: toCentralIso(end) };
      const free = await ownFreeBlocks(store, agent, range);
      const busy = (await ownCalendar(store, agent))
        .filter((event) => Date.parse(event.end) > start && Date.parse(event.start) < end)
        .map((event) => ({ title: event.title, start: event.start, end: event.end, private: event.private }));
      const { now } = await store.getClock();
      return { timezone: "US Central (UTC-05:00)", now, free, busy };
    },

    get_interests: async (raw) => {
      const parsed = InterestsArgs.safeParse(raw);
      if (!parsed.success) return badArgs(parsed.error);
      const interests = getPersona(agent).interests;
      return parsed.data.category ? { [parsed.data.category]: interests[parsed.data.category] ?? [] } : interests;
    },

    read_signal: async (raw) => {
      const parsed = ReadSignalArgs.safeParse(raw);
      if (!parsed.success) return badArgs(parsed.error);
      const signal = await store.getSignal(parsed.data.signal_id ?? ctx.signalId ?? "");
      if (!signal || signal.to !== agent) return { error: "No signal found for you." };
      return {
        signal_id: signal.id,
        from: displayName(signal.from),
        message: signal.dmText ?? null,
        reel: { caption: signal.media.caption, account: signal.media.username, posted: signal.media.timestamp, type: signal.media.media_product_type },
      };
    },

    record_reel_details: async (raw) => {
      const parsed = ReelDetailsArgs.safeParse(raw);
      if (!parsed.success) return badArgs(parsed.error);
      const signal = await store.getSignal(ctx.signalId ?? "");
      if (!signal) return { error: "No signal to attach details to." };
      const at = toCentralIso(nowMs());
      const updated: Signal = { ...signal, extracted: { source: "caption_model", model: MODEL_NAME, ...parsed.data, at } };
      await store.putSignal(updated);
      const plan = await store.getPlanByContext(ctx.contextId);
      const row: ActivityEvent = {
        id: newId("evt", nowMs()),
        at,
        kind: "caption_extracted",
        actor: "agent",
        agent,
        contextId: ctx.contextId,
        planId: plan?.id,
        text: `${displayName(agent)} read the reel caption: ${parsed.data.place}${parsed.data.area ? `, ${parsed.data.area}` : ""}${parsed.data.hours ? `, ${parsed.data.hours.toLowerCase()}` : ""} (extracted by the caption model)`,
      };
      await store.appendEvent(row);
      return { ok: true, saved: parsed.data, free_hint: plan?.window ? describeWindow(plan.window) : undefined };
    },

    send_to_friend_agent: (raw, meta) => sendToFriend(ctx, raw, meta),
  };

  return { tools, handlers };
}
