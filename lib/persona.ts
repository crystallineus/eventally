// The app's AI assistant has a name and a face, but always says it's an AI (see ideas.md:
// "AI 一開始就表明自己是 AI"). Use these everywhere a person would read about the AI.
export const ASSISTANT = {
  name: "Aunt Tally",
  /** First name Even, last name Tally: the app is named after her. */
  fullName: "Even Tally",
  /** Shown next to her name wherever she first appears, so nobody mistakes her for a person. */
  disclosure: "AI assistant",
} as const;
