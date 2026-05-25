import type { Database as BetterSqlite3Database } from "better-sqlite3";
import type { SlashCommand } from "@harness/shared";
import { isoNow } from "./mapping.js";

interface SlashCommandDbRow {
  id: string;
  name: string;
  description: string;
  template: string;
  created_at: string;
  updated_at: string;
}

function rowToDomain(row: SlashCommandDbRow): SlashCommand {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    template: row.template,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SlashCommandsRepo {
  constructor(private readonly raw: BetterSqlite3Database) {}

  list(): SlashCommand[] {
    const rows = this.raw
      .prepare("SELECT * FROM slash_commands ORDER BY name ASC")
      .all() as SlashCommandDbRow[];
    return rows.map(rowToDomain);
  }

  getById(id: string): SlashCommand | undefined {
    const row = this.raw
      .prepare("SELECT * FROM slash_commands WHERE id = ?")
      .get(id) as SlashCommandDbRow | undefined;
    return row ? rowToDomain(row) : undefined;
  }

  getByName(name: string): SlashCommand | undefined {
    const row = this.raw
      .prepare("SELECT * FROM slash_commands WHERE name = ?")
      .get(name) as SlashCommandDbRow | undefined;
    return row ? rowToDomain(row) : undefined;
  }

  create(
    id: string,
    name: string,
    description: string,
    template: string,
  ): SlashCommand {
    const now = isoNow();
    this.raw
      .prepare(
        `INSERT INTO slash_commands (id, name, description, template, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, name, description, template, now, now);
    return { id, name, description, template, createdAt: now, updatedAt: now };
  }

  update(
    id: string,
    fields: { name?: string | undefined; description?: string | undefined; template?: string | undefined },
  ): boolean {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (fields.name !== undefined) {
      sets.push("name = ?");
      params.push(fields.name);
    }
    if (fields.description !== undefined) {
      sets.push("description = ?");
      params.push(fields.description);
    }
    if (fields.template !== undefined) {
      sets.push("template = ?");
      params.push(fields.template);
    }
    if (sets.length === 0) return false;
    sets.push("updated_at = ?");
    params.push(isoNow());
    params.push(id);
    const result = this.raw
      .prepare(`UPDATE slash_commands SET ${sets.join(", ")} WHERE id = ?`)
      .run(...params);
    return result.changes > 0;
  }

  delete(id: string): boolean {
    const result = this.raw
      .prepare("DELETE FROM slash_commands WHERE id = ?")
      .run(id);
    return result.changes > 0;
  }

  seedBuiltins(): number {
    const builtins = [
      {
        name: "explain",
        description: "Explain the following code in detail",
        template:
          "Explain the following code in detail. Focus on the logic flow and any non-obvious behavior:\n\n{{code_or_file}}",
      },
      {
        name: "review",
        description: "Code review the current changes",
        template:
          "Review the following code for bugs, security issues, performance problems, and improvements:\n\n{{code_or_file}}",
      },
      {
        name: "test",
        description: "Write comprehensive tests for the code",
        template:
          "Write comprehensive tests for the following code. Match the project's existing test patterns:\n\n{{code_or_file}}",
      },
      {
        name: "fix",
        description: "Fix the following error",
        template:
          "Fix the following error. Explain the root cause and provide the corrected code:\n\n{{error}}",
      },
      {
        name: "refactor",
        description: "Refactor code for readability and best practices",
        template:
          "Refactor the following code to improve readability, reduce complexity, and follow best practices:\n\n{{code_or_file}}",
      },
    ];

    let seeded = 0;
    for (const cmd of builtins) {
      const existing = this.getByName(cmd.name);
      if (!existing) {
        const id = crypto.randomUUID();
        this.create(id, cmd.name, cmd.description, cmd.template);
        seeded++;
      }
    }
    return seeded;
  }
}
