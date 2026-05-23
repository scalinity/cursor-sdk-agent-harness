#!/usr/bin/env node
// Phase 02 stub. The destructive reset path lands in Phase 04 alongside the
// real DB. This stub refuses to run without an explicit confirmation flag so
// the contract is correct from day one.
import process from "node:process";

const confirmed = process.argv.includes("--confirm");
if (!confirmed) {
  process.stderr.write(
    "[reset-local-db] refusing to run without --confirm. " +
      "Phase 02 stub: no database exists yet.\n",
  );
  process.exit(2);
}

process.stdout.write(
  "[reset-local-db] no-op stub (Phase 02). Drizzle DB lands in Phase 04.\n",
);
process.exit(0);
