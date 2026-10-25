import { NextResponse } from "next/server";
import { readSnapshot } from "@/lib/ui/source";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(readSnapshot(), { headers: { "Cache-Control": "no-store" } });
}
