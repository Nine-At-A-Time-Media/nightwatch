/**
 * Tracker settings -- the values the github runtime's composition root reads
 * once and hands the Code and GitHub use cases (architecture Parameters
 * placed: "settings" are Worker vars).
 */

export type TrackerSettings = {
  /** The console origin evidence links point to; they open only behind Access. */
  readonly consoleBaseUrl: string;
  /** Labels every tracker issue Nightwatch opens carries. */
  readonly labels: readonly string[];
  /** The App's own login on the tracker; a change it made is never applied back. */
  readonly appActor: string;
  /** The first line that marks a tracker comment for the reporter. */
  readonly shareMarker: string;
  /** Consecutive refused pushes after which an External Link is Broken; at least one. */
  readonly maxRefusals: number;
};
