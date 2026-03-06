// @flow

// Chalk-based styling helpers, spinners, and prompt utilities

import chalk from "chalk";
import ora from "ora";
import { confirm, select, search, input } from "@inquirer/prompts";
import { CancelPromptError } from "@inquirer/core";

export { CancelPromptError };

/**
 * Wraps an @inquirer/prompts call so that pressing Escape cancels it.
 * The prompt functions return a cancellable promise (has a .cancel() method).
 * We listen for the Escape key (\x1b not followed by [ which would be an
 * arrow/control sequence) and call .cancel() when detected.
 */
function withEscapeCancel/*:: <T> */(
  promptPromise: any,
): Promise<any> {
  const onKeypress = (data: Buffer) => {
    // Escape is \x1b (27). Arrow keys send \x1b[ so we ignore those.
    if (data.length === 1 && data[0] === 0x1b) {
      promptPromise.cancel();
    }
  };

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.on("data", onKeypress);

  return promptPromise.finally(() => {
    process.stdin.removeListener("data", onKeypress);
  });
}

export const ui = {
  _dryRunMode: false,

  setDryRun(enabled: boolean): void {
    this._dryRunMode = enabled;
  },

  _tag(message: string): string {
    if (this._dryRunMode) {
      return `${chalk.bgRed.white(" DRY RUN ")} ${message}`;
    }
    return message;
  },

  header(text: string): void {
    console.log();
    console.log(chalk.bold.cyan(`⚛️  ━━━ ${text} ━━━`));
    console.log();
  },

  success(text: string): void {
    console.log(chalk.green(`✔ ${text}`));
  },

  error(text: string): void {
    console.log(chalk.red(`✖ ${text}`));
  },

  warn(text: string): void {
    console.log(chalk.yellow(`⚠ ${text}`));
  },

  info(text: string): void {
    console.log(chalk.blue(`ℹ ${text}`));
  },

  dim(text: string): void {
    console.log(chalk.dim(text));
  },

  step(index: number, total: number, text: string): void {
    console.log(chalk.cyan(`[${index}/${total}]`) + ` ${text}`);
  },

  table(rows: Array<[string, string]>): void {
    const maxKey = Math.max(...rows.map(([k]) => k.length));
    for (const [key, value] of rows) {
      console.log(`  ${chalk.bold(key.padEnd(maxKey))}  ${value}`);
    }
  },

  divider(): void {
    console.log(chalk.dim("─".repeat(50)));
  },

  spinner(text: string): any {
    return ora({ text, color: "cyan" }).start();
  },

  statusBadge(status: string): string {
    const badges: {[string]: string} = {
      success: chalk.bgGreen.black(" PASS "),
      failure: chalk.bgRed.white(" FAIL "),
      pending: chalk.bgYellow.black(" PEND "),
      running: chalk.bgBlue.white(" RUN  "),
      skipped: chalk.bgGray.white(" SKIP "),
    };
    return badges[status] ?? chalk.bgGray.white(` ${status.toUpperCase()} `);
  },

  async confirm(message: string, defaultValue?: boolean): Promise<boolean> {
    return confirm({ message: this._tag(message), default: defaultValue ?? false });
  },

  async select(
    message: string,
    choices: Array<{name: string, value: string, description?: string}>,
  ): Promise<string> {
    return select({ message: this._tag(message), choices });
  },

  async search(
    message: string,
    choices: Array<{name: string, value: string, description?: string}>,
  ): Promise<string> {
    const tagged = this._tag(message);
    return withEscapeCancel(
      search({
        message: tagged,
        source: (term) => {
          if (!term) return choices;
          const lower = term.toLowerCase();
          return choices.filter(
            (c) =>
              c.name.toLowerCase().includes(lower) ||
              c.value.toLowerCase().includes(lower) ||
              (c.description ?? "").toLowerCase().includes(lower),
          );
        },
      }),
    );
  },

  async input(message: string, defaultValue?: string): Promise<string> {
    return withEscapeCancel(
      input({ message: this._tag(message), default: defaultValue }),
    );
  },

  dryRun(action: string): void {
    console.log(chalk.magenta(`[DRY RUN] ${action}`));
  },

  docRef(url: string): void {
    console.log(chalk.dim(`  📖 ${url}`));
    console.log();
  },
};
