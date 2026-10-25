import type { Metadata } from "next";
import { HowPage } from "@/components/HowPage";
import { howCopy } from "@/lib/how";

export const metadata: Metadata = {
  title: "How Muse Friends works",
  description: howCopy.subtitle,
};

/** Static: no store reads, no model calls, no client state. The same on every visit. */
export default function Page() {
  return <HowPage />;
}
