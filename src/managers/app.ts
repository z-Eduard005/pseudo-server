import { join, basename, normalize } from "path";
import { copyFile, readFile, writeFile, mkdir, rename, rm } from "fs/promises";
import {
  IS_WIN32,
  DESKTOP_DIR,
  LINUX_SHELL,
  USER_DIR,
} from "../constants";
import { run, retryRun, log, throwErr, tryCatch, exists } from "../utils";
import Zerotier from "./zerotier";
import Tlauncher from "./tlauncher";
import Process from "./process";
import GH from "./gh";
import UI from "./ui";

type GithubRelease = {
  tag_name: string;
  assets: {
    name: string;
    browser_download_url: string
  }[]
}

export default class App {
  static readonly DIR = IS_WIN32 ? join(USER_DIR, "AppData", "Roaming", "pseudo-server") : join(USER_DIR, ".config", "pseudo-server");
  static readonly INSTANCES_DIR = join(App.DIR, "instances");
  static readonly NAME = "Pseudo-Server";
  private static readonly VERSION = "0.0.15";
  private static readonly RELEASE_URL = "https://api.github.com/repos/z-Eduard005/pseudo-server/releases/latest"
  private static readonly RAW_GITHUB_URL = "https://raw.githubusercontent.com/z-Eduard005/pseudo-server/main";
  private static readonly FILE = join(App.DIR, IS_WIN32 ? App.NAME + ".exe" : App.NAME);
  private static readonly CONFIG_FILE = join(App.DIR, "config.json");
  private static readonly ICON_FILE = join(App.DIR, IS_WIN32 ? "icon.ico" : "icon.png");
  private static readonly SHORTCUT_FILE = join(App.DIR, `${App.NAME}.lnk`);
  private static readonly DESKTOP_ENTRY_PATH = join(USER_DIR, ".local", "share", "applications");
  private static readonly DESKTOP_ENTRY_FILE = join(App.DESKTOP_ENTRY_PATH, App.NAME + ".desktop");

  private static isNewerVersion(releaseTag: string): boolean {
    const [r0 = 0, r1 = 0, r2 = 0] = releaseTag.replace(/^v/, "").split(".").map(Number);
    const [c0 = 0, c1 = 0, c2 = 0] = App.VERSION.split(".").map(Number);
    return r0 > c0 || (r0 === c0 && r1 > c1) || (r0 === c0 && r1 === c1 && r2 > c2);
  }

  static async getConfig(file: string): Promise<Record<string, unknown>> {
    if (!(await exists(file))) return {};

    return await tryCatch(
      async () => JSON.parse(await readFile(file, "utf8")),
      `Failed to read config file: ${file}`
    );
  }

  static async putConfig(file: string, data: Record<string, unknown>) {
    const existing = await App.getConfig(file);
    await tryCatch(
      () => writeFile(file, JSON.stringify({ ...(existing ?? {}), ...data })),
      `Failed to write config file: ${file}`
    );
  }

  private static async createEntry() {
    return await tryCatch(async () => {
      if (!(await exists(App.ICON_FILE))) {
        await run(
          `curl -fsSL ${App.RAW_GITHUB_URL}/assets/${basename(App.ICON_FILE)} -o "${App.ICON_FILE}"`,
          { inherit: true }
        );
      }

      if (IS_WIN32 && !(await exists(App.SHORTCUT_FILE))) {
        await retryRun(() => {
          return run(
            `powershell -Command "${`
            $WshShell = New-Object -ComObject WScript.Shell
            $Shortcut = $WshShell.CreateShortcut('${App.SHORTCUT_FILE}')
            $Shortcut.TargetPath = 'powershell'
            $Shortcut.Arguments = '-Command "Start-Process -FilePath ''${App.FILE}'' -Verb RunAs -WindowStyle Normal"'
            $Shortcut.WorkingDirectory = '${App.DIR}'
            $Shortcut.IconLocation = '${App.ICON_FILE},0'
            $Shortcut.Description = '${App.NAME}'
            $Shortcut.Save()`.replace(/\n/g, "; ")}"`,
            { inherit: true }
          );
        });

        await copyFile(App.SHORTCUT_FILE, join(DESKTOP_DIR, basename(App.SHORTCUT_FILE)));
      } else if (!IS_WIN32) {
        await writeFile(
          App.DESKTOP_ENTRY_FILE,
          `[Desktop Entry]
          Name=${App.NAME}
          Exec=${LINUX_SHELL} -lc "DRI_PRIME=1 ${App.FILE}"
          Terminal=true
          Type=Application
          Icon=${App.ICON_FILE}
          Categories=Application;`,
          "utf8"
        );
        await run(`update-desktop-database ${App.DESKTOP_ENTRY_PATH}`, { inherit: true });
      }
    }, `Failed to create a shortcut for ${App.NAME}`);
  }

  private static async moveBinnary() {
    const processPath = normalize(process.execPath).toLowerCase();
    const appFile = normalize(App.FILE).toLowerCase();
    if (processPath === appFile) return;

    if (IS_WIN32) {
      if (await exists(App.FILE)) await rm(App.FILE, { force: true });
      await rename(process.execPath, App.FILE);
      log(`Please restart the app with the shortcut "${App.SHORTCUT_FILE}"`, "warning")
    } else {
      await rename(process.execPath, App.FILE);
      log(`Please restart the app with the file "${App.DESKTOP_ENTRY_FILE}"`, "warning")
    }

    await Process.stop();
  }

  private static async checkUpdates() {
    await tryCatch(async () => {
      const res = await UI.withLoader(async () => await fetch(App.RELEASE_URL));
      if (!res.ok) {
        log(`Update check failed:\n\nstatus: ${res.status}\nstatusText: ${res.statusText}\nbody: ${res.body}`, "warning");
        return;
      }

      const release = (await res.json()) as GithubRelease;
      if (!App.isNewerVersion(release.tag_name)) return;

      const assetName = IS_WIN32 ? App.NAME + ".exe" : App.NAME;
      const asset = release.assets.find(a => a.name === assetName);
      if (!asset) throwErr(`No download found for ${assetName} in release ${release.tag_name}`);

      log(`Downloading ${release.tag_name}...`, "info");
      const dl = await UI.withLoader(async () => await fetch(asset!.browser_download_url));
      const buffer = Buffer.from(await dl.arrayBuffer());

      await writeFile(`${App.FILE}.tmp`, buffer);
      await rename(`${App.FILE}.tmp`, App.FILE);
      if (!IS_WIN32) await run(`chmod +x ${App.FILE}`);

      log("Update downloaded. Please restart the app", "success");
      await Process.stop();
    }, "Failed to update the program");
  }

  static async setup() {
    await mkdir(App.DIR, { recursive: true });
    log(`${App.NAME} v${App.VERSION}`, "info")
    await App.createEntry();
    await App.moveBinnary();

    await Tlauncher.install();
    await Zerotier.install();

    await GH.installGit();
    await GH.ensureAuth();

    const config = await App.getConfig(App.CONFIG_FILE);
    if (config?.["installed"] !== true) {
      log("Pseudo-Server successfully installed :)", "success");
      await App.putConfig(App.CONFIG_FILE, { installed: true });
    }

    await App.checkUpdates();
  }

  static async initInstance(serverName: string, serverVersion: string) {
    const instanceDir = join(App.INSTANCES_DIR, serverName);
    await mkdir(instanceDir, { recursive: true });
    await Tlauncher.setupServerVersion(serverVersion, serverName);
    await App.putConfig(join(instanceDir, "config.json"), { name: serverName });
  }
}
