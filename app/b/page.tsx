import type { Metadata } from "next";
import { PhoneRoute } from "@/components/PhoneRoute";

export const metadata: Metadata = { title: "Muse Friends, Phone B" };

export default function PhoneB() {
  return <PhoneRoute role="b" />;
}
