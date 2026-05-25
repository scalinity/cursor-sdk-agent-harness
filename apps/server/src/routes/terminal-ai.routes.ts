import type { FastifyInstance } from "fastify";
import { generateCommandRequestSchema } from "@harness/shared";

export type TerminalAiRoutesDeps = Record<string, never>;

const DANGEROUS_PATTERNS = [
  /\brm\s+(-[^\s]*\s+)*-r/i,
  /\brm\s+(-[^\s]*\s+)*-f/i,
  /\brmdir\b/i,
  /\bkill\s/i,
  /\bkillall\b/i,
  /\bpkill\b/i,
  /\bDROP\s+TABLE\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bTRUNCATE\b/i,
  /\bchmod\s+777\b/i,
  /\bchown\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-fd\b/i,
  /\bgit\s+push\s+--force\b/i,
  /\bgit\s+push\s+-f\b/i,
  />\s*\/dev\/null/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
];

export function isDangerous(command: string): boolean {
  return DANGEROUS_PATTERNS.some((p) => p.test(command));
}

interface PatternRule {
  match: RegExp;
  generate: (m: RegExpMatchArray, prompt: string) => string;
  explain: string;
}

const PATTERNS: PatternRule[] = [
  {
    match: /(?:search|grep)\s+(?:for\s+)?["']?([^"']+?)["']?\s+(?:in|across)\s+(.+)/i,
    generate: (m) => `grep -rn "${m[1]}" ${m[2]}`,
    explain: "Search for a pattern in files",
  },
  {
    match: /(?:list|show)\s+(?:all\s+)?(?:running\s+)?processes/i,
    generate: () => "ps aux | head -30",
    explain: "List running processes",
  },
  {
    match: /disk\s+(?:usage|space)/i,
    generate: () => "du -sh * | sort -rh | head -20",
    explain: "Show disk usage of current directory contents, sorted by size",
  },
  {
    match: /(?:list|show|find)\s+(?:all\s+)?(\w+)\s+files?\s+(?:larger|bigger|over|above)\s+(\d+)\s*(\w+)?/i,
    generate: (m) => {
      const ext = m[1]!.toLowerCase();
      const size = m[2]!;
      const unit = (m[3] ?? "k")[0]!.toLowerCase();
      return `find . -name "*.${ext}" -size +${size}${unit}`;
    },
    explain: "Find files by extension and minimum size",
  },
  {
    match: /(?:list|show|find)\s+(?:all\s+)?(\w+)\s+files?/i,
    generate: (m) => `find . -name "*.${m[1]!.toLowerCase()}" -type f`,
    explain: "Find files by extension",
  },
  {
    match: /(?:search|find|grep)\s+(?:for\s+)?["']?([^"']+?)["']?/i,
    generate: (m) => `grep -rn "${m[1]}" .`,
    explain: "Search for a pattern in the current directory",
  },
  {
    match: /(?:count|how many)\s+lines?\s+(?:of\s+)?(?:code)?/i,
    generate: () => `find . -name "*.ts" -o -name "*.tsx" | xargs wc -l | tail -1`,
    explain: "Count total lines of TypeScript code",
  },
  {
    match: /(?:show|display|cat|read)\s+(.+)/i,
    generate: (m) => `cat ${m[1]!.trim()}`,
    explain: "Display file contents",
  },
  {
    match: /(?:what|which)\s+port/i,
    generate: () => "lsof -i -P -n | grep LISTEN",
    explain: "Show processes listening on network ports",
  },
];

function generateFromPattern(prompt: string): {
  command: string;
  explanation: string;
} | null {
  for (const rule of PATTERNS) {
    const m = prompt.match(rule.match);
    if (m) {
      return {
        command: rule.generate(m, prompt),
        explanation: rule.explain,
      };
    }
  }
  return null;
}

export async function registerTerminalAiRoutes(
  app: FastifyInstance,
  _deps: TerminalAiRoutesDeps,
): Promise<void> {
  app.post("/api/terminal/generate-command", async (request, reply) => {
    const parsed = generateCommandRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ code: "VALIDATION_ERROR", message: parsed.error.message });
    }

    const result = generateFromPattern(parsed.data.prompt);
    if (result) {
      return reply.send({
        command: result.command,
        explanation: result.explanation,
        dangerous: isDangerous(result.command),
      });
    }

    return reply.send({
      command: `# ${parsed.data.prompt}`,
      explanation:
        "Could not generate a specific command. The prompt has been included as a comment.",
      dangerous: false,
    });
  });
}
