/* Every user-facing string that is not derived from data, in one place. */
export const copy = {
  brand: "Muse Friends",
  tagline: "A proposal for Muse",
  activityTitle: "Activity",
  activityEmpty: (first: string, second: string) => `Nothing yet. When ${first} and ${second} talk, every message shows up here.`,
  reconnecting: "Reconnecting...",

  statusReading: (friend: string) => `🎞️ reading ${friend}'s reel`,
  statusTalking: (muse: string) => `💬 talking to ${muse}`,
  statusWaitingYou: "⏳ waiting for you",
  statusWaitingFriend: (friend: string) => `⏳ waiting for ${friend}`,
  statusTrouble: (muse: string) => `⚠️ having trouble reaching ${muse}`,

  proposalBubble: (friend: string, place: string, when: string) =>
    `You and ${friend} both want to try ${place}, and you're both free ${when}.`,
  cardTitle: (muse: string, friend: string) => `${muse} wants to make a plan with ${friend}`,
  /** `reelOwner` is already possessive: "Lisa's" or "your". */
  cardReason: (reelOwner: string) => `Based on ${reelOwner} reel and both calendars.`,
  placeKeptPrivate: "Place kept private",
  declineA: "Not now",
  acceptA: "Reach out",
  declineB: "Not now",
  acceptB: "Sounds good",
  youSaidYes: "✓ You said yes",
  youPassed: "You said not now",
  friendPassed: (friend: string) => `${friend} said not now.`,
  friendSaidYes: (muse: string, friend: string) => `${muse} said yes for ${friend}`,

  draftIntroA: (friend: string) => `${friend}'s in. Here's a message you can send ${friend}.`,
  draftIntroB: (friend: string) => `${friend} is sending you a message on WhatsApp.`,
  draftCopy: "Copy",
  draftCopied: "Copied",
  draftOpenWhatsApp: "Open WhatsApp",
  holdBubble: (when: string) => `I added a hold for ${when}.`,
  holdTitle: (activity: string, friend: string) => `${activity} with ${friend}`,
  holdAction: "Add to calendar",
  reminder: (activity: string, friend: string, time: string) => `${activity} with ${friend} at ${time}.`,
  followUp: (friend: string) => `How was it? Want me to find a time with ${friend} next month?`,
  dropped: (friend: string) => `${friend}'s Muse couldn't find a time that works this week. I'll keep an eye out.`,

  oldExchangeThem: "We should try that shawarma place!",
  oldExchangeYou: "Yes, let's go!",

  modelErrorFirst: (muse: string) => `${muse} didn't answer in time. Trying again.`,
  modelErrorSecond: (muse: string) => `Still no answer from ${muse}. Use Replay to keep going.`,

  followThrough: "Follow-through",
  agentMessagesNotCounted: (count: number) => `Agent messages: ${count} (not counted)`,
  humanTapsNotCounted: (count: number) => `Taps and sends: ${count} (not counted)`,
  followThroughEmpty: "Nothing has happened yet. This counts plans that actually took place.",

  liveLabel: "Live",
  replayLabel: "Replay of a recorded run",
  replayShort: "Replay",
  simulatedClock: "Simulated clock",
  simulatedFriendBanner: "Simulated friend, fictional, played by a model",

  drawerClose: "Close",
  drawerCopy: "Copy JSON",
  drawerSent: "Sent",
  drawerRemoved: "Removed by policy",
  drawerRemovedNone: "Nothing removed",
  drawerModelCall: "Model call",
  drawerNoModelCall: "No model call for this message",
} as const;
