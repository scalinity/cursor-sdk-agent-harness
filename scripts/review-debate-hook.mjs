#!/usr/bin/env node

/**
 * Review debate hook.
 *
 * Usage:
 *   node scripts/review-debate-hook.mjs --reviewer "Reviewer summary" --codex "Codex summary"
 *
 * Prints a merge-comment-ready block that explicitly hands off to Codex.
 */

function getArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return "";
  const nextArg = process.argv[index + 1];
  if (nextArg === undefined || nextArg.startsWith("-")) return "";
  return nextArg;
}

const reviewer = getArg("--reviewer").trim();
const codex = getArg("--codex").trim();

const reviewerBlock = reviewer.length > 0 ? reviewer : "(reviewer notes pending)";
const codexBlock = codex.length > 0 ? codex : "(codex counterpoints pending)";

const mergeComment = [
  "## Review Debate",
  "",
  "### Reviewer position",
  reviewerBlock,
  "",
  "### Codex position",
  codexBlock,
  "",
  "### Handoff",
  "<@U0B6G38BPNV> you have the mic for the final merge verdict.",
].join("\n");

process.stdout.write(`${mergeComment}\n`);
