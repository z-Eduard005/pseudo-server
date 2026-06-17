type Render = (draw: () => string, handleKey: (key: string) => void, title?: string, desc?: string, backText?: string) => {
  cleanup: () => void;
  rerender: () => void;
};

export default class UI {
  private static readonly PADDING = 1;
  private static readonly BG = "\x1B[48;5;235m";
  private static readonly FG = "\x1B[38;5;255m";
  private static readonly RST = "\x1B[39m\x1B[49m";
  static readonly START_ART = `┏━┓┏━┓┏━╸╻ ╻╺┳┓┏━┓   ┏━┓┏━╸┏━┓╻ ╻┏━╸┏━┓
┣━┛┗━┓┣╸ ┃ ┃ ┃┃┃ ┃╺━╸┗━┓┣╸ ┣┳┛┃┏┛┣╸ ┣┳┛
╹  ┗━┛┗━╸┗━┛╺┻┛┗━┛   ┗━┛┗━╸╹┗╸┗┛ ┗━╸╹┗╸`;

  private static cols(): number {
    return process.stdout.columns || 80;
  }

  private static wrap(text: string, maxWidth: number): string[] {
    const lines: string[] = [];
    for (const segment of text.split("\n")) {
      if (segment.length <= maxWidth) {
        lines.push(segment);
      } else {
        for (let i = 0; i < segment.length; i += maxWidth) {
          lines.push(segment.slice(i, i + maxWidth));
        }
      }
    }
    return lines;
  }

  private static render: Render = (draw, handleKey, title, desc, backText) => {
    const TITLE_WIDTH = 50;
    const stdin = process.stdin;

    try { stdin.setRawMode(true); } catch { };
    stdin.resume();
    stdin.setEncoding("utf8");

    process.stdout.write("\x1B[?25l\x1B[?1049h");

    const renderFrame = () => {
      const c = UI.cols();
      const r = process.stdout.rows || 24;

      if (c < 82 || r < 24) {
        const msg = `Terminal too small — need 82x24, have ${c}x${r}`;
        const pad = Math.max(0, Math.floor((r - 1) / 2));
        process.stdout.write("\x1B[2J\x1B[H");
        process.stdout.write("\n".repeat(pad));
        process.stdout.write(" ".repeat(Math.max(0, Math.floor((c - msg.length) / 2))));
        process.stdout.write("\x1B[41m\x1B[97m" + msg + "\x1B[39m\x1B[49m\n");
        return;
      }

      const backLine = `\x1B[2m<- ${backText || "Back"} (esc)\x1B[22m`;

      const contentLines: string[] = [];

      if (title) {
        const lines = title.includes("\n") ? title.split("\n") : UI.wrap(title, TITLE_WIDTH);
        lines.forEach((l, i) => {
          const indent = title.includes("\n")
            ? " ".repeat(Math.max(0, Math.floor((UI.cols() - l.length) / 2)))
            : " ".repeat(Math.max(0, Math.floor((UI.cols() - TITLE_WIDTH) / 2)));
          contentLines.push(i === 0 ? `${indent}\x1B[1m${l}\x1B[22m` : `${indent}${l}`);
        });
      }
      if (desc) {
        const lines = desc.includes("\n") ? desc.split("\n") : UI.wrap(desc, TITLE_WIDTH);
        lines.forEach((l, i) => {
          const indent = desc.includes("\n")
            ? " ".repeat(Math.max(0, Math.floor((UI.cols() - l.length) / 2)))
            : " ".repeat(Math.max(0, Math.floor((UI.cols() - TITLE_WIDTH) / 2)));
          contentLines.push(i === 0 ? `${indent}\x1B[2m${l}\x1B[22m` : `${indent}${l}`);
        });
      }
      if (title || desc) contentLines.push("");

      const rawList = draw();
      if (rawList) {
        contentLines.push(...rawList.split("\n"));
      }

      const termHeight = process.stdout.rows || 24;
      const topPadding = Math.max(0, Math.floor((termHeight - 1 - contentLines.length) / 2));

      process.stdout.write("\x1B[2J\x1B[H");
      process.stdout.write(backLine + "\n");
      process.stdout.write("\n".repeat(topPadding));
      process.stdout.write(contentLines.join("\n"));
    };

    renderFrame();

    process.stdout.on("resize", renderFrame);
    stdin.on("data", handleKey);

    const cleanup = () => {
      process.stdout.removeListener("resize", renderFrame);
      stdin.removeListener("data", handleKey);
      process.stdout.write("\x1B[?1049l\x1B[?25h");
    };

    return { cleanup, rerender: renderFrame };
  }

  static menu(items: string[], title?: string, desc?: string, backText?: string): Promise<{ value: string | null; cancelled: boolean }> {
    return new Promise((resolve) => {
      let selectedIndex = 0;
      let keyHandler: (key: string) => void = () => { };

      const draw = () => {
        const LIST_WIDTH = 50;
        const SEL_BG = "\x1B[48;5;27m";
        const SEL_FG = "\x1B[38;5;255m";
        const TEXT_AREA = LIST_WIDTH - 2 * UI.PADDING;
        const listLeft = Math.floor((UI.cols() - LIST_WIDTH) / 2);
        const listIndent = " ".repeat(Math.max(0, listLeft));
        const emptyLine = `${listIndent}${UI.BG}${UI.FG}${" ".repeat(LIST_WIDTH)}${UI.RST}`;

        const itemLines = items.flatMap((item, index) => {
          const wrapped = item.length > TEXT_AREA ? UI.wrap(item, TEXT_AREA) : [item];
          return wrapped.map((l, i) => {
            const plain = l.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
            const rightFill = Math.max(0, LIST_WIDTH - UI.PADDING - plain.length);

            if (index === selectedIndex && i === 0) {
              return `${listIndent}${SEL_BG}${SEL_FG}${" ".repeat(UI.PADDING)}\x1B[1m${l}\x1B[22m${" ".repeat(rightFill)}${UI.RST}`;
            }
            const style = i === 0 ? "\x1B[1m" : "";
            const resetStyle = i === 0 ? "\x1B[22m" : "";
            return `${listIndent}${UI.BG}${UI.FG}${" ".repeat(UI.PADDING)}${style}${l}${resetStyle}${" ".repeat(rightFill)}${UI.RST}`;
          });
        });

        return [emptyLine, ...itemLines, emptyLine].join("\n");
      };

      const { cleanup, rerender } = UI.render(draw, (key) => keyHandler(key), title, desc, backText);

      keyHandler = (key) => {
        if (key === "\u001b") {
          cleanup();
          resolve({ value: null, cancelled: true });
          return;
        }
        if (key === "\r" || key === "\r\n") {
          cleanup();
          resolve({ value: items[selectedIndex]!, cancelled: false });
          return;
        }
        if (key === "\u001b[A") {
          selectedIndex = selectedIndex > 0 ? selectedIndex - 1 : items.length - 1;
          rerender();
          return;
        }
        if (key === "\u001b[B") {
          selectedIndex = selectedIndex < items.length - 1 ? selectedIndex + 1 : 0;
          rerender();
          return;
        }
      };
    });
  }

  static input(title?: string, desc?: string, defaultValue?: string, backText?: string, maxLen?: number): Promise<{ value: string; cancelled: boolean }> {
    return new Promise((resolve) => {
      let value = defaultValue ?? "";
      let cursorPos = value.length;
      let triedSubmit = false;
      let keyHandler: (key: string) => void = () => { };

      const MAX_LEN = Math.min(maxLen ?? 50, 100);
      const CURSOR_BG = "\x1B[48;5;27m";

      const getError = (): string | null => {
        if (value.length <= 3) return "Must be more than 3 symbols";
        return null;
      };

      const draw = () => {
        const inputWidth = Math.min(MAX_LEN, UI.cols() - 4);
        const left = Math.floor((UI.cols() - inputWidth) / 2);
        const indent = " ".repeat(Math.max(0, left));
        const emptyLine = `${indent}${UI.BG}${UI.FG}${" ".repeat(inputWidth)}${UI.RST}`;

        let offset = 0;
        if (cursorPos >= inputWidth) {
          offset = cursorPos - inputWidth + 1;
        }
        if (offset > 0 && offset + inputWidth > value.length) {
          offset = Math.max(0, value.length - inputWidth);
        }
        if (offset + inputWidth > value.length + 1 && value.length < MAX_LEN) {
          offset = Math.max(0, value.length + 1 - inputWidth);
        }

        let visible = "";
        for (let i = 0; i < inputWidth; i++) {
          const charIndex = offset + i;
          const isCursor = charIndex === cursorPos;

          if (charIndex < value.length) {
            visible += isCursor
              ? `${CURSOR_BG}\x1B[38;5;15m${value[charIndex]!}${UI.BG}${UI.FG}`
              : value[charIndex]!;
          } else {
            visible += isCursor
              ? `${CURSOR_BG} ${UI.BG}${UI.FG}`
              : `\x1B[2m_\x1B[22m`;
          }
        }

        const line = `${indent}${UI.BG}${UI.FG}${visible}${UI.RST}`;

        const error = getError();
        const errorLine = triedSubmit && error
          ? `${indent}\x1B[38;5;196m* ${error}\x1B[39m`
          : null;

        const parts = [emptyLine, line, emptyLine];
        if (errorLine) parts.push(errorLine);
        return parts.join("\n");
      };

      const { cleanup, rerender } = UI.render(draw, (key) => keyHandler(key), title, desc, backText);

      keyHandler = (key) => {
        if (key === "\u001b") {
          cleanup();
          resolve({ value, cancelled: true });
          return;
        }
        if (key === "\r" || key === "\r\n") {
          if (getError()) {
            triedSubmit = true;
            rerender();
            return;
          }
          cleanup();
          resolve({ value, cancelled: false });
          return;
        }
        if (key === "\x7f" || key === "\b") {
          if (cursorPos > 0) {
            value = value.slice(0, cursorPos - 1) + value.slice(cursorPos);
            cursorPos--;
            rerender();
          }
          return;
        }
        if (key === "\u001b[D") {
          if (cursorPos > 0) {
            cursorPos--;
            rerender();
          }
          return;
        }
        if (key === "\u001b[C") {
          if (cursorPos < value.length) {
            cursorPos++;
            rerender();
          }
          return;
        }
        if (key.length > 1 && key.charCodeAt(0) !== 27) {
          const sanitized = [...key].filter((c) => {
            const code = c.charCodeAt(0);
            return code >= 33 && code <= 126;
          }).join("");
          if (sanitized.length === 0) return;
          const available = MAX_LEN - value.length;
          const paste = sanitized.slice(0, available);
          if (paste.length > 0) {
            value = value.slice(0, cursorPos) + paste + value.slice(cursorPos);
            cursorPos += paste.length;
            rerender();
          }
          return;
        }
        if (key.length === 1 && key.charCodeAt(0) >= 33 && value.length < MAX_LEN) {
          value = value.slice(0, cursorPos) + key + value.slice(cursorPos);
          cursorPos++;
          rerender();
          return;
        }
      };
    });
  }
}
