import { useEffect, useState } from "react";
import { normalizeTerminalSize, type TerminalSize } from "./layout.js";

export function useTerminalSize(stdout: NodeJS.WriteStream = process.stdout): TerminalSize {
  const [size, setSize] = useState(() => normalizeTerminalSize(stdout.columns, stdout.rows));

  useEffect(() => {
    const update = () => setSize(normalizeTerminalSize(stdout.columns, stdout.rows));
    stdout.on("resize", update);
    update();
    return () => {
      stdout.off("resize", update);
    };
  }, [stdout]);

  return size;
}
