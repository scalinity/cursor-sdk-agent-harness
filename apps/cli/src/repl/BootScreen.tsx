import path from "node:path";
import { CLI_DISPLAY_NAME } from "@harness/shared";
import { Box, Text, useApp, useInput } from "ink";
import { bg, createTuiTheme, fg, type TuiTheme } from "./theme.js";
import { useSpinnerFrame } from "./useSpinnerFrame.js";

export interface BootScreenProps {
  workspace?: string;
  theme?: TuiTheme;
}

/**
 * Painted the instant `orrery` launches, before the embedded server has booted.
 * Gives immediate visual feedback while the heavy in-process server starts in the
 * background, and lets the user abort the boot with Ctrl+C / Ctrl+D / Esc.
 */
export function BootScreen({ workspace, theme = createTuiTheme() }: BootScreenProps) {
  const { exit } = useApp();
  const spinner = useSpinnerFrame(true);
  useInput((input, key) => {
    if (key.escape || (key.ctrl && (input === "c" || input === "d"))) exit();
  });
  const where = workspace ? ` · ${path.basename(workspace) || workspace}` : "";
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} {...bg(theme.background)}>
      <Text {...fg(theme.brand)} bold>{CLI_DISPLAY_NAME}</Text>
      <Box marginTop={1}>
        <Text {...fg(theme.state?.running)}>{spinner} </Text>
        <Text {...fg(theme.muted)}>Starting Orrery{where}…</Text>
      </Box>
      <Box marginTop={1}>
        <Text {...fg(theme.muted)}>Ctrl+C to cancel</Text>
      </Box>
    </Box>
  );
}
