import { Home as HomeRoute } from "@/components/Home";
import { displayName } from "@/lib/seed/personas";

export default function Home() {
  return <HomeRoute sides={{ a: displayName("aaron"), b: displayName("lisa") }} />;
}
