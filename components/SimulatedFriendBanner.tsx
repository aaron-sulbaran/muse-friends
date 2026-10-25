import { copy } from "@/lib/ui/copy";
import { modelLabel } from "@/lib/ui/model-name";
import { SimulatedFriendDisc } from "./PersonDisc";

/**
 * The strip across the top of Michelle's phone: she is fictional, and a model plays her. It names the model ("Muse Spark
 * 1.3", or the fallback that actually answered) and stays on one line at 390 and inside the stage's phone frame: 12
 * over medium, never breaking, with an ellipsis as the guard for a longer model id.
 */
export function SimulatedFriendBanner({ model }: { model?: string }) {
  return (
    <p className="flex shrink-0 items-center justify-center gap-2 overflow-hidden bg-group px-3 py-2 text-center text-[12px] font-medium tracking-[-0.01em] whitespace-nowrap">
      <SimulatedFriendDisc size={20} />
      <span className="min-w-0 truncate">{model ? copy.simulatedFriendBannerModel(modelLabel(model)) : copy.simulatedFriendBanner}</span>
    </p>
  );
}
