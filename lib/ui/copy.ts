/* Every user-facing string that is not derived from data, in one place. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 25": the month and day of a recording, read from its ISO time as written (our recordings carry the Central offset). */
export function recordingDate(iso: string): string {
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  return MONTHS[month - 1] && day > 0 ? `${MONTHS[month - 1]} ${day}` : "an earlier date";
}

export const copy = {
  brand: "Muse Friends",
  // One string, so swapping in the Meta lockup later (once Meta clears it) is this line and nothing else.
  tagline: "a proposal for Muse",
  howItWorks: "How it works",
  // The stage header's three moments, in the order they happen. The lines are the CDO's (header-activity README).
  momentSaidYes: "Said yes",
  momentSaidYesLine: "Both people tapped Set it up on the plan.",
  momentMessageSent: "Message sent",
  momentMessageSentLine: "The plan went out to both people's chats.",
  momentTheyWent: "They went",
  momentTheyWentLine: "Both people tapped We went after the plan. This is the number we measure: plans that happened, not messages sent.",
  momentNotYet: "Not yet",
  momentShow: "Show in conversation",
  activityTitle: "Activity",
  activityEmpty: (first: string, second: string) => `Nothing yet. When ${first} and ${second} talk, every message shows up here.`,
  reconnecting: "Reconnecting...",

  // Status lines are words only; the state's animated glyph (public/status) comes from the phone view.
  statusReading: (friend: string) => `reading ${friend}'s reel`,
  statusTalking: (muse: string) => `talking to ${muse}`,
  statusThinking: "thinking it over",
  statusWaitingYou: "waiting for you",
  statusWaitingFriend: (friend: string) => `waiting for ${friend}`,
  statusDone: "sent",
  statusTrouble: (muse: string) => `having trouble reaching ${muse}`,

  proposalBubble: (friend: string, place: string, when: string) =>
    `You and ${friend} both want to try ${place}, and you're both free ${when}.`,
  cardTitle: (muse: string, friend: string) => `${muse} wants to make a plan with ${friend}`,
  /** `reelOwner` is already possessive: "Lisa's" or "your". */
  cardReason: (reelOwner: string) => `Based on ${reelOwner} reel and both calendars.`,
  placeKeptPrivate: "Place kept private",
  cardReplan: "That time doesn't work for me",
  declineA: "Not now",
  acceptA: "Reach out",
  declineB: "Not now",
  acceptB: "Sounds good",
  youSaidYes: "✓ You said yes",
  youPassed: "You said not now",
  friendPassed: (friend: string) => `${friend} said not now.`,
  friendIsIn: (muse: string) => `${muse} is in`,

  draftIntroA: (friend: string) => `${friend}'s in. Here's a message you can send ${friend}.`,
  draftIntroB: (friend: string) => `${friend} is sending you a message on WhatsApp.`,
  draftCopy: "Copy",
  draftCopied: "Copied",
  draftOpenWhatsApp: "Open WhatsApp",
  draftHandedOff: "Continue this conversation in WhatsApp",
  draftOpenAgain: "Open again",
  holdBubble: (when: string) => `I added a hold for ${when}.`,
  holdTitle: (activity: string, friend: string) => `${activity} with ${friend}`,
  holdAction: "Add to calendar",
  holdGoogle: "Add to Google Calendar",
  holdAdded: "Added to your calendar",
  holdChangePlans: "Change plans",
  /** A person's own words to the friend; the Muse never sends it. */
  changePlansDraft: "Hey, can we change our plans?",
  holdDetails: (first: string, second: string) => `${first} and ${second} planned this in Muse Friends.`,
  reminder: (activity: string, friend: string, time: string) => `${activity} with ${friend} at ${time}.`,
  followUp: "Did you two make it?",
  outcomeWent: "We went!",
  outcomeDidnt: "Didn't happen",
  outcomeWentReply: "Love that. That's one plan that made it out of the chat.",
  outcomeDidntReply: (activity: string) => `No worries, plans slip. I'll keep ${activity} in mind for another time.`,
  closingLine: "✓ Done. It's in Goals.",
  nudgeSent: (friend: string) => `Can you check with ${friend} about the shawarma reel?`,
  reelLabel: "Sample reel",
  reelLiveLabel: "Lisa's own reel, live from Instagram",
  reelLivePlace: "Instagram reel",
  dropped: (friend: string) => `${friend}'s Muse couldn't find a time that works this week. I'll keep an eye out.`,

  sendReelTitle: (friend: string) => `Still want that shawarma plan with ${friend}?`,
  sendReelDetail: "The reel from last week is still sitting in the chat. Your Muse can pick it up.",
  sendReelAction: (friend: string) => `Check with ${friend}`,
  simulatedTitle: "No friend here?",
  simulatedDetail: "Play with a simulated friend: Michelle, fictional, played by a model.",
  simulatedAction: "Play with a simulated friend",
  activityOpen: "Activity",
  activityClose: "Close Activity",
  // Money: whole paper dollars, on Capital One's sandbox or a local ledger.
  walletLabel: "Capital One sandbox",
  paymentSent: (amount: string, friend: string) => `You sent ${friend} ${amount}`,
  paymentReceived: (amount: string, friend: string) => `${friend} sent you ${amount}`,
  paymentWaitingFriend: (muse: string) => `Waiting on ${muse}`,
  paymentWaitingYou: "Waiting for your Muse",
  paymentKept: (friend: string) => `${friend} has it`,
  paymentKeptYou: (before: string, after: string) => `Kept. Your balance went from ${before} to ${after}`,
  paymentKeptYouPlain: "Kept",
  paymentRefundedPayer: (friend: string) => `${friend}'s Muse sent it back`,
  paymentRefundedPayee: "You sent it back",
  paymentDetails: "Details",
  paymentDrawerTitle: "Payment",
  paymentDrawerRecord: "The ledger's record, as stored",
  settleTitle: (friend: string) => `Settle up with ${friend}?`,
  settleNotePlaceholder: "Add a note, like I'll cover the plate",
  settleNoteLabel: "Optional note for your Muse about how to settle up",
  settleAction: "Settle up",
  settleWorking: "Your Muse is settling up...",
  settleOffTitle: "Settle up is off",
  settleOffDetail: "Let your Muse send money for this plan. You set the most per plan.",
  settleOffAction: "Turn on payments",
  paymentsSection: "Payments",
  paymentsTabSettings: "Settings",
  paymentsTabHistory: "History",
  historyWith: (friend: string) => `History with ${friend}`,
  historyEmpty: "No payments yet. When your Muse settles up for a plan, it shows here.",
  historyLoading: "Loading...",
  historyStandingWaiting: "Waiting",
  historyStandingKept: "Kept",
  historyStandingBack: "Sent back",
  paymentsSwitch: "Let my Muse send money",
  paymentsSwitchHint: (cap: string) => `Up to ${cap} per plan. The limit is enforced in code on both ends.`,
  paymentsCap: "Most per plan, in dollars",
  paymentsCapOff: "A limit of 0 keeps payments off",
  paymentsOffDetail: "Off unless you turn it on.",
  invitePill: "Invite",
  inviteTitle: "Invite a friend",
  inviteLine: "They'll get their own Muse, and yours will plan with theirs.",
  inviteRestartLine: "Bringing a friend in starts this plan over.",
  inviteNotNow: "Not now",
  inviteStartOver: "Start over with a friend",
  inviteQrLabel: "QR code for your friend's link",
  inviteCopy: "Copy link",
  inviteCopied: "Copied",
  inviteSwitching: "Making room for your friend...",
  goalsTitle: "Goals",
  goalsTracking: "Tracking",
  goalsEmpty: (friend: string) => `Nothing tracked yet. When you and ${friend} settle on a plan, it shows up here.`,
  oldExchangeThem: "We should try that shawarma place!",
  oldExchangeYou: "Yes, let's go!",

  modelErrorFirst: (muse: string) => `${muse} didn't answer in time. Trying again.`,
  modelErrorSecond: (muse: string) => `Still no answer from ${muse}. Use Replay to keep going.`,
  failedPlan: (muse: string) => `${muse} didn't answer, so this plan stopped.`,


  liveLabel: "Live",
  replayLabel: "Replay of a recorded run",
  replayShort: "Replay",
  /** The badge text for a replay, saying what is playing: a real run with the date it was recorded, or the scripted fallback. */
  replayBadge: (recording: { source: "live" | "scripted"; recordedAt: string } | undefined, compact: boolean) => {
    if (!recording) return compact ? "Replay" : "Replay of a recorded run";
    if (recording.source === "scripted") return compact ? "Replay, scripted" : "Replay of a scripted run";
    const date = recordingDate(recording.recordedAt);
    return compact ? `Replay, recorded ${date}` : `Replay of a real run, recorded ${date}`;
  },
  replayStart: "Watch a recorded run",
  simulatedClock: "Simulated clock",
  simulatedFriendBanner: "Simulated friend, fictional, played by a model",

  // The thread with the friend (D32): who said what, and which Muse belongs to which person.
  threadMuseOf: (owner: string) => `${owner}'s Muse`,
  threadYourMuse: "your Muse",
  threadSimulated: "Simulated",
  threadSimulatedCard: (name: string) => `${name} is played by a model for this demo.`,
  threadOnlyYou: "Only you see this",
  /** Above your own private question to your Muse. */
  threadToMuse: (muse: string) => `To ${muse}, only you see this`,
  /** A Muse's note to its own person when policy kept something out of a message. `withheld` is already a list: "location and interests". */
  threadKeptOut: (withheld: string, friendMuse: string) => `I kept ${withheld} out of what I sent ${friendMuse}.`,
  /** What the simulated friend says once she has decided, scripted to the plan's state. */
  threadFriendYes: "Yes, I'm in.",
  threadFriendNo: "Not this time, sorry.",

  // The composer at the bottom of Sprout's phone (D31, D32): talk to the friend, or ask your own Muse in private.
  composerMessage: (friend: string) => `Message ${friend}`,
  composerAskPill: (muse: string) => `Ask ${muse}`,
  composerAskPlaceholder: (muse: string) => `Ask ${muse} privately`,
  composerAskUnavailable: (muse: string) => `Asking ${muse} is not available yet`,
  composerSend: "Send",
  composerSending: "Sending",

  drawerClose: "Close",
  drawerCopy: "Copy JSON",
  drawerSent: "Sent",
  drawerRemoved: "Removed by policy",
  drawerRemovedNone: "Nothing removed",
  drawerModelCall: "Model call",
  drawerToolsCalled: "Tools called",
  drawerToolReturned: "Returned",
  drawerBudget: "Live run budget",
  pausedBack: "Back to live",
  pausedFallback: "Live runs paused, playing a recording",
  drawerNoModelCall: "No model call for this message",

} as const;

/** The onboarding in the chat (D26), word for word from kb/design/onboarding.md. `friend` is the room's friend. A separate object so `copy` stays flat. */
export const onboardingCopy = {
  greeting: "Hi, I'm Sprout, your Muse.",
  nameTitle: "What should friends call you?",
  nameLabel: "Your first name",
  namePlaceholder: "First name",
  friendsLine: "Friends lets your Muse and a friend's Muse find a time together.",
  friendsPoints: ["Only people you pick are included.", "You choose what it can mention.", "It never guesses closeness from how often you text."],
  notNow: "Not now",
  turnOn: "Turn on Friends",
  changeAnytime: "Change this anytime in Sharing.",
  optOutTitle: "Here is what we consider when you opt out",
  optOutOff:
    "Friends is off. Your Muse will not talk to friends' Muses, and theirs will not talk to yours. It still helps with what you tell it directly.",
  optOutNothingShared:
    "If a friend tells their own Muse about plans with you, that stays in their Muse. We do not guess who is close to you, and nothing about you is shared.",
  gotIt: "Got it",
  turnOnAnytime: "Turn it on anytime in Sharing.",
  needsFriends: (friend: string) => `Want to plan this with ${friend}? That needs Friends.`,

  // Screen 2: who can the Muse talk to.
  whoTitle: "Who can your Muse talk to?",
  whoLine: "Close friends share more. Friends share less. Nobody is added unless you add them.",
  syncTitle: "Sync your close friends from Instagram",
  syncLine: "Brings in the Close Friends list you made there. Seeded for this demo.",
  pickTitle: "Pick friends",
  pickLine: "Choose people one by one.",
  notTold: "They are not told which group they are in.",
  syncedTitle: "Your close friends",
  seededChip: "Seeded for this demo",
  syncedLine: "From the Close Friends list you made on Instagram. Change anyone.",
  onCloseFriends: "On your Instagram Close Friends",
  back: "Back",
  continue: "Continue",
  whoOf: (friend: string) => `Who ${friend} is to you`,

  // Screen 3: what to share with one friend. `tier` is the tier's own label ("Close friend", "Friend").
  shareTitle: (friend: string) => `What can ${friend}'s Muse see?`,
  shareLine: (friend: string, tier: string) =>
    `Set from ${friend}'s group, ${tier}. Change any of them. Off means Muse leaves it out and says so in Activity.`,
  done: "Done",
  /** The persistent indicator on the avatar sheet's shield while Friends is on. */
  friendsIsOn: "Friends is on",
} as const;
