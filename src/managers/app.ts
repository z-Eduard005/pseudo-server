import { join } from "path";
import { IS_WIN32, USER_DIR } from "../constants";
import { readFile, writeFile } from "fs/promises";
import { exists, tryCatch } from "../utils";

export default class App {
  static readonly DIR = IS_WIN32 ? join(USER_DIR, "AppData", "Roaming", "pseudo-server") : join(USER_DIR, ".config", "pseudo-server");
  static readonly NAME = "Pseudo-Server";
  static readonly FILE = join(App.DIR, IS_WIN32 ? App.NAME + ".exe" : App.NAME);
  static readonly CONFIG_FILE = join(App.DIR, "config.json");

  static async getConfig(): Promise<Record<string, unknown> | undefined> {
    if (!(await exists(App.CONFIG_FILE))) {
      return undefined;
    }
    return await tryCatch(
      async () => {
        return JSON.parse(await readFile(App.CONFIG_FILE, "utf8"));
      },
      "Failed to read config file"
    );
  }

  static async putConfig(data: Record<string, unknown>) {
    const existing = await App.getConfig();
    await tryCatch(
      () => {
        return writeFile(App.CONFIG_FILE, JSON.stringify({ ...(existing ?? {}), ...data }));
      },
      "Failed to write config file"
    );
  }

  static async checkUpdates() { }
}
