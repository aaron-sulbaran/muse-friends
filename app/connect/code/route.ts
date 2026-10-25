import { productionDeps } from "@/app/api/connector/_lib/byom";
import { judgeKeyConfigured, mintCode } from "@/app/api/connector/_lib/keyless";

export const dynamic = "force-dynamic";

// The button on /connect: mints a link code for the person at the table and sends the browser back to the page
// with the code in the address, so reloading never mints another. Closed with the rest of the station.
export async function POST() {
  const back = (query: string) => new Response(null, { status: 303, headers: { Location: `/connect${query}`, "Cache-Control": "no-store" } });
  if (!judgeKeyConfigured()) return back("");
  const outcome = await mintCode(productionDeps());
  if (outcome.ok) return back(`?code=${outcome.value.code}`);
  return back(`?notice=${outcome.code === "room_cap" ? "room_cap" : "unavailable"}`);
}
