import type { Metadata } from "next";
import { PhoneRoute } from "@/components/PhoneRoute";

export const metadata: Metadata = { title: "Muse Friends, Phone A" };

export default function PhoneA() {
  return <PhoneRoute role="a" />;
}
