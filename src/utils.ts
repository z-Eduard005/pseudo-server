import type { ChildProcessWithoutNullStreams } from "child_process";
import { spawn } from "child_process";
import { setTimeout as setTimeoutPromise } from "timers/promises";
import { IS_WIN32, LINUX_SHELL, CONFIG_FILE } from "./constants";
import type { TryCatch, Run, LogType } from "./types";
import { access, constants, readFile, writeFile } from "fs/promises";

export const run: Run = async (commands, options) => {
  const result: string[] = [],
    commandsArray: string[] = Array.isArray(commands) ? commands : [commands],
    spawnFn = (c: string) => {
      return spawn(c, {
        shell: IS_WIN32 ? true : LINUX_SHELL,
        cwd: options?.cwd,
        env: process.env
      });
    };

  for (const cmd of commandsArray) {
    result.push(
      await new Promise(async (resolve, reject) => {
        let child: ChildProcessWithoutNullStreams | undefined;
        if (cmd.startsWith("git ")) {
          child = await retryRun(() => {
            return spawnFn(cmd);
          });
        } else {
          child = spawnFn(cmd);
        }

        let stdout = "",
          stderr = "";
        child.stdout.on("data", (chunk) => {
          stdout += chunk;
          if (options?.inherit) {
            process.stdout.write(chunk);
          }
        });
        child.stderr.on("data", (chunk) => {
          stderr += chunk;
          if (options?.inherit) {
            process.stderr.write(chunk);
          }
        });

        child.on("close", (code) => {
          return code === 0
            ? resolve(stdout.trim())
            : reject(
              new Error(
                stderr.trim() || `${cmd}\nfailed with exit code ${code}`
              )
            );
        });
      })
    );
  }
  return (
    options?.inherit ? null : result.length === 1 ? result[0] : result
  ) as never;
};

export const isSuccess = async (fn: () => unknown) => {
  try {
    await fn();
    return true;
  } catch {
    return false;
  }
};

export const exists = (path: string) => {
  return isSuccess(async () => {
    return await access(path, constants.F_OK);
  });
};

export const retryRun = async <Return>(fn: () => Return | Promise<Return>) => {
  let result, isFailed;
  for (const l = { maxAtts: 3, att: 1, interval: 2000 }; l.att <= l.maxAtts; l.att++) {
    result = await tryCatch(fn, async (err) => {
      isFailed = true;
      if (l.att === l.maxAtts) {
        throwErr(err);
      }
      await setTimeoutPromise(l.interval);
    });
    if (isFailed) {
      isFailed = false;
    } else {
      break;
    }
  }
  return result as Return;
};

export const color = (str: string, type: LogType) => {
  return `\x1b[3${type === "success" ? 2 : type === "warning" ? 3 : type === "error" ? 1 : 4}m\x1b[1m${str}\x1b[0m`;
};

export const log = (msg: string, type?: LogType) => {
  return console.log(type ? color(msg, type) : msg);
};

export const throwErr = (msg?: string) => {
  throw new Error(msg && color(msg.replace("Error: ", ""), "error"));
};

export const tryCatch: TryCatch = async (fn, msgOrFn, isWarn) => {
  try {
    return await fn();
  } catch (err) {
    const stringErr = String(err);
    return (
      typeof msgOrFn !== "string"
        ? msgOrFn && (await msgOrFn(stringErr))
        : isWarn
          ? log(msgOrFn, "warning")
          : throwErr(`${msgOrFn}:\n${stringErr}`)
    ) as never;
  }
};

export const randomNum = (length: number) => {
  return Math.floor(Math.random() * Number("1e" + length.toFixed(0).replace("-", "")));
};

export const isWingetInstalled = () => {
  return isSuccess(() => {
    return run("where winget", { inherit: true });
  });
};

export const sudo = (cmd: string) => {
  return IS_WIN32 ? cmd : `sudo ${cmd}`;
};

export const getConfig = async (): Promise<Record<string, unknown> | undefined> => {
  if (!(await exists(CONFIG_FILE))) {
    return undefined;
  }
  return await tryCatch(
    async () => {
      return JSON.parse(await readFile(CONFIG_FILE, "utf8"));
    },
    "Failed to read config file"
  );
};

export const putConfig = async (data: Record<string, unknown>) => {
  const existing = await getConfig();
  await tryCatch(
    () => {
      return writeFile(CONFIG_FILE, JSON.stringify({ ...(existing ?? {}), ...data }));
    },
    "Failed to write config file"
  );
};

export const runMenu = (title: string, desc: string, menuItems: string[]) => {
  return new Promise<string | null>((resolve) => {
    let selectedIndex = 0;
    const stdin = process.stdin;

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    process.stdout.write("\x1B[?25l\x1B[?1049h");

    function renderMenu() {
      process.stdout.write("\x1B[2J\x1B[H");

      const totalCols = process.stdout.columns;
      const totalRows = process.stdout.rows;

      const formattedTitle = `\x1B[1m${title}\x1B[22m`;

      const contentLines = [title, desc, "", ...menuItems];
      const startRow = Math.floor((totalRows - contentLines.length) / 2);
      for (let r = 0; r < startRow; r++) process.stdout.write("\n");

      const maxHeaderWidth = Math.max(title.length, desc.length);
      const headerStartCol = Math.floor((totalCols - maxHeaderWidth) / 2);
      const headerIndent = " ".repeat(Math.max(0, headerStartCol));

      process.stdout.write(`${headerIndent}${formattedTitle}\n`);
      process.stdout.write(`${headerIndent}\x1B[2m${desc}\x1B[22m\n\n`);

      menuItems.forEach((item, index) => {
        const visualTextLength = item.length + 4;
        const startCol = Math.floor((totalCols - visualTextLength) / 2);
        const indent = " ".repeat(Math.max(0, startCol));

        if (index === selectedIndex) {
          process.stdout.write(`${indent}\x1B[1;7m  ${item}  \x1B[22;27m\n`);
        } else {
          process.stdout.write(`${indent}\x1B[1m  ${item}  \x1B[22m\n`);
        }
      });
    }

    renderMenu();

    const handleResize = () => {
      return renderMenu();
    };
    process.stdout.on("resize", handleResize);

    const handleData = (key: string) => {
      if (key === "\u0003" || key === "\u001b") {
        cleanup(null);
      }
      if (key === "\r" || key === "\n") {
        cleanup(menuItems[selectedIndex]!);
      }
      if (key === "\u001b[A") {
        selectedIndex =
          selectedIndex > 0 ? selectedIndex - 1 : menuItems.length - 1;
        renderMenu();
      }
      if (key === "\u001b[B") {
        selectedIndex =
          selectedIndex < menuItems.length - 1 ? selectedIndex + 1 : 0;
        renderMenu();
      }
    };
    stdin.on("data", handleData);

    function cleanup(result: string | null) {
      process.stdout.removeListener("resize", handleResize);
      stdin.removeListener("data", handleData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\x1B[?1049l\x1B[?25h");
      resolve(result);
    }
  });
};

