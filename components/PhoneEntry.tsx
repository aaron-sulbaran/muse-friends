"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { phoneRootHref } from "@/lib/ui/entry";
import { newRoomId } from "@/lib/ui/room";

/**
 * The root page on a phone: a judge scanned the QR and holds one device, so there is nothing to choose. It goes
 * straight to Sprout's side of a room of its own, with Michelle playing the friend until a real one is invited.
 */
export function PhoneEntry() {
  const router = useRouter();
  useEffect(() => {
    router.replace(phoneRootHref(newRoomId()));
  }, [router]);
  return <div className="min-h-dvh bg-screen" />;
}
