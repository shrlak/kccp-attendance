#!/usr/bin/env node
/**
 * Multi-model AI dev assistant for KCCP attendance project.
 *
 * Primary : claude-sonnet-4-6  — fast edits and questions
 * Advisor : claude-opus-4-7    — complex tasks (prefix request with "!")
 *
 * Token budget: configure via MAX_TOKENS env var (default 100,000 per session).
 * The script counts tokens BEFORE every request and prompts for confirmation
 * when the cumulative session total would exceed the limit — no tokens are
 * spent past the threshold without explicit [y] approval.
 *
 * Usage: node ai-dev.js
 *        MAX_TOKENS=50000 node ai-dev.js
 */

const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const MODEL_PRIMARY = "claude-sonnet-4-6";
const MODEL_ADVISOR = "claude-opus-4-7";

// Project root is one level up from this tools/ directory.
const ROOT = path.join(__dirname, "..");

// Paths are relative to ROOT.
const PROJECT_FILES = ["server.js", "index.html", "data/config.json"];

// Session token budget — hard limit before a confirmation gate fires.
const SESSION_TOKEN_LIMIT = parseInt(process.env.MAX_TOKENS || "100000", 10);

const client = new Anthropic();

// ── Token budget tracker ──────────────────────────────────────────────────

const sessionUsage = { input: 0, output: 0, cacheRead: 0, total: 0 };

function recordUsage(apiUsage) {
  sessionUsage.input     += apiUsage.input_tokens        || 0;
  sessionUsage.output    += apiUsage.output_tokens       || 0;
  sessionUsage.cacheRead += apiUsage.cache_read_input_tokens || 0;
  // total = all input-side tokens + output tokens
  sessionUsage.total = sessionUsage.input + sessionUsage.output + sessionUsage.cacheRead;
}

function budgetBar() {
  const pct = Math.min(1, sessionUsage.total / SESSION_TOKEN_LIMIT);
  const filled = Math.round(pct * 20);
  const bar = "█".repeat(filled) + "░".repeat(20 - filled);
  return `[${bar}] ${sessionUsage.total.toLocaleString()} / ${SESSION_TOKEN_LIMIT.toLocaleString()}`;
}

// ── Project file loading ──────────────────────────────────────────────────

function loadProjectContext() {
  return PROJECT_FILES
    .filter((name) => fs.existsSync(path.join(ROOT, name)))
    .map((name) => ({ name, content: fs.readFileSync(path.join(ROOT, name), "utf-8") }));
}

// Build system prompt blocks with a prompt-cache breakpoint on the last file.
// Render order is tools → system → messages, so a breakpoint on the last system
// block caches everything before it (all file content) as a shared prefix.
function buildSystemBlocks(files) {
  const intro = {
    type: "text",
    text: [
      "You are an expert Node.js web developer helping edit and improve the KCCP NFC attendance system.",
      "The project is a pure Node.js HTTP server (no framework) with a vanilla JS frontend.",
      "When suggesting code changes, output the FULL updated file content wrapped in:",
      "  <file name=\"FILENAME\">",
      "  ...full file content...",
      "  </file>",
      "Only emit files you actually changed. Be concise in explanations.",
    ].join("\n"),
  };

  const fileBlocks = files.map(({ name, content }, i) => {
    const block = { type: "text", text: `<file name="${name}">\n${content}\n</file>` };
    if (i === files.length - 1) {
      // Cache breakpoint on the last file — caches the entire shared prefix.
      block.cache_control = { type: "ephemeral" };
    }
    return block;
  });

  return [intro, ...fileBlocks];
}

// ── Apply file edits from model response ──────────────────────────────────

function applyEdits(responseText) {
  const regex = /<file name="([^"]+)">([\s\S]*?)<\/file>/g;
  let match;
  const applied = [];

  while ((match = regex.exec(responseText)) !== null) {
    const [, name, content] = match;
    // Allow only known safe relative paths (no ".." traversal, no absolute paths).
    if (name.includes("..") || path.isAbsolute(name)) {
      console.log(`  ⚠  Skipped unsafe path: ${name}`);
      continue;
    }
    fs.writeFileSync(
      path.join(ROOT, name),
      content.replace(/^\n/, "").replace(/\n$/, "\n"),
      "utf-8"
    );
    applied.push(name);
  }

  return applied;
}

// ── Token gate: confirm before exceeding the session budget ───────────────

async function confirmBudgetOverrun(ask, estimatedInputTokens) {
  const projectedTotal = sessionUsage.total + estimatedInputTokens;
  if (projectedTotal <= SESSION_TOKEN_LIMIT) return true; // within budget — proceed

  console.log("\n  ⚠  Token budget warning");
  console.log(`     Session so far  : ${sessionUsage.total.toLocaleString()} tokens`);
  console.log(`     This request    : ~${estimatedInputTokens.toLocaleString()} tokens`);
  console.log(`     Projected total : ${projectedTotal.toLocaleString()} tokens`);
  console.log(`     Budget limit    : ${SESSION_TOKEN_LIMIT.toLocaleString()} tokens`);
  console.log(`     Overage         : +${(projectedTotal - SESSION_TOKEN_LIMIT).toLocaleString()} tokens\n`);

  const answer = (await ask("  Proceed anyway? [y/N] ")).trim().toLowerCase();
  console.log();
  return answer === "y";
}

// ── Main interactive loop ─────────────────────────────────────────────────

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (prompt) => new Promise((resolve) => rl.question(prompt, resolve));

  console.log("╔══════════════════════════════════════════════╗");
  console.log("║   KCCP Attendance — AI Dev Assistant         ║");
  console.log("╠══════════════════════════════════════════════╣");
  console.log("║  Primary  : claude-sonnet-4-6                ║");
  console.log("║  Advisor  : claude-opus-4-7  (prefix !)      ║");
  console.log(`║  Budget   : ${SESSION_TOKEN_LIMIT.toLocaleString().padEnd(32)}║`);
  console.log("║  Type 'exit' to quit, 'usage' for stats      ║");
  console.log("╚══════════════════════════════════════════════╝\n");

  const conversationHistory = [];

  while (true) {
    const input = (await ask("You: ")).trim();
    if (!input) continue;
    if (input.toLowerCase() === "exit") break;

    if (input.toLowerCase() === "usage") {
      console.log(`\n  Session usage  : ${sessionUsage.total.toLocaleString()} tokens`);
      console.log(`  Input tokens   : ${sessionUsage.input.toLocaleString()}`);
      console.log(`  Output tokens  : ${sessionUsage.output.toLocaleString()}`);
      console.log(`  Cache reads    : ${sessionUsage.cacheRead.toLocaleString()}`);
      console.log(`  Budget         : ${budgetBar()}\n`);
      continue;
    }

    // "!" prefix or "advisor" keyword → escalate to Opus
    const useAdvisor = input.startsWith("!") || /\badvisor\b/i.test(input);
    const userText   = useAdvisor ? input.replace(/^!/, "").trim() : input;
    const model      = useAdvisor ? MODEL_ADVISOR : MODEL_PRIMARY;

    // Reload files so any edits from the previous turn are reflected.
    const files        = loadProjectContext();
    const systemBlocks = buildSystemBlocks(files);

    // Append the user message tentatively so the count includes it.
    conversationHistory.push({ role: "user", content: userText });

    // ── Pre-flight: count tokens BEFORE spending them ──────────────────
    let estimatedInputTokens = 0;
    try {
      const countResp = await client.messages.countTokens({
        model,
        system: systemBlocks,
        messages: conversationHistory,
      });
      estimatedInputTokens = countResp.input_tokens;
    } catch {
      // Count endpoint unavailable — skip the estimate, still gate on current total.
    }

    // If already at or over budget (regardless of estimate), gate here too.
    const alreadyOver = sessionUsage.total >= SESSION_TOKEN_LIMIT;
    if (alreadyOver) {
      console.log(`\n  ⚠  Session budget of ${SESSION_TOKEN_LIMIT.toLocaleString()} tokens has been reached.`);
      console.log(`     Current usage: ${sessionUsage.total.toLocaleString()} tokens\n`);
      const answer = (await ask("  Proceed anyway? [y/N] ")).trim().toLowerCase();
      console.log();
      if (answer !== "y") {
        conversationHistory.pop();
        console.log("  Skipped — no tokens used.\n");
        continue;
      }
    } else if (estimatedInputTokens > 0) {
      // Check if this request would push us over.
      const allowed = await confirmBudgetOverrun(ask, estimatedInputTokens);
      if (!allowed) {
        conversationHistory.pop();
        console.log("  Skipped — no tokens used.\n");
        continue;
      }
    }

    const label = useAdvisor ? `[advisor: ${MODEL_ADVISOR}]` : `[primary: ${MODEL_PRIMARY}]`;
    console.log(`\n${label} Thinking…\n`);

    try {
      const response = await client.messages.create({
        model,
        max_tokens: 8192,
        system: systemBlocks,
        messages: conversationHistory,
      });

      // Record actual usage immediately.
      recordUsage(response.usage);

      const assistantText = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");

      conversationHistory.push({ role: "assistant", content: assistantText });

      // Print response — collapse file blocks to one-liners for readability.
      const displayText = assistantText.replace(
        /<file name="[^"]+">[\s\S]*?<\/file>/g,
        (m) => `[updated: ${m.match(/<file name="([^"]+)">/)[1]}]`
      );
      console.log(`Assistant: ${displayText}\n`);

      // Apply any file edits.
      const applied = applyEdits(assistantText);
      if (applied.length > 0) {
        console.log(`  ✓ Files updated: ${applied.join(", ")}\n`);
      }

      // Usage summary for this turn.
      const u = response.usage;
      const cacheNote = u.cache_read_input_tokens > 0
        ? ` (${u.cache_read_input_tokens.toLocaleString()} from cache)`
        : "";
      console.log(
        `  Tokens this turn: ${(u.input_tokens + u.output_tokens).toLocaleString()}` +
        cacheNote +
        `  |  Session: ${budgetBar()}\n`
      );

    } catch (err) {
      // Remove the speculative user turn from history on error.
      conversationHistory.pop();

      if (err instanceof Anthropic.RateLimitError) {
        console.error("  Rate limited — please wait a moment and retry.\n");
      } else if (err instanceof Anthropic.APIError) {
        // Treat billing/credit errors (402, or 400 with billing message) as a hard stop.
        const isBillingError =
          err.status === 402 ||
          (err.status === 400 && /credit|billing|quota|usage.limit/i.test(err.message));

        if (isBillingError) {
          console.error("\n  ✖  Account usage limit reached (API error).");
          console.error(`     ${err.message}`);
          console.error("     No further tokens will be used until you confirm.\n");
          const answer = (await ask("  Try again anyway? [y/N] ")).trim().toLowerCase();
          console.log();
          if (answer !== "y") continue;
          // Re-push user message if retrying.
          conversationHistory.push({ role: "user", content: userText });
        } else {
          console.error(`  API error (${err.status}): ${err.message}\n`);
        }
      } else {
        throw err;
      }
    }
  }

  rl.close();
  console.log(`\nSession ended. Total tokens used: ${sessionUsage.total.toLocaleString()}`);
  console.log("Goodbye!\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
