// eslint-disable-next-line no-control-regex
const ansiPattern = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/g;
const unsafeControlRanges = `${Array.from({ length: 9 }, (_, code) => `\\u${code.toString(16).padStart(4, "0")}`).join("")}\\u000b\\u000c${Array.from({ length: 18 }, (_, index) => `\\u${(index + 14).toString(16).padStart(4, "0")}`).join("")}\\u007f`;
const unsafeControlPattern = new RegExp(`[${unsafeControlRanges}]`, "g");

export function sanitizeTerminalText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(ansiPattern, "").replace(unsafeControlPattern, "");
}
