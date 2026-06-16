import { join, basename, normalize } from "path";
import { copyFile, readFile, writeFile, mkdir, rename } from "fs/promises";
import { spawn } from "child_process";
import {
  IS_WIN32,
  DESKTOP_DIR,
  LINUX_SHELL,
  USER_DIR,
} from "../constants";
import { run, retryRun, log, throwErr, tryCatch, isSuccess, sudo, exists } from "../utils";
import Zerotier from "./zerotier";
import Tlauncher from "./tlauncher";
import Process from "./process";

type GithubRelease = {
  tag_name: string;
  assets: {
    name: string;
    browser_download_url: string
  }[]
}

export default class App {
  static readonly DIR = IS_WIN32 ? join(USER_DIR, "AppData", "Roaming", "pseudo-server") : join(USER_DIR, ".config", "pseudo-server");
  static readonly NAME = "Pseudo-Server";
  private static readonly VERSION = "1.0.1";
  private static readonly RELEASE_URL = "https://api.github.com/repos/z-Eduard005/pseudo-server/releases/latest"
  private static readonly RAW_GITHUB_URL = "https://raw.githubusercontent.com/z-Eduard005/pseudo-server/main";
  private static readonly FILE = join(App.DIR, IS_WIN32 ? App.NAME + ".exe" : App.NAME);
  private static readonly CONFIG_FILE = join(App.DIR, "config.json");
  private static readonly GIT_PACKAGES = IS_WIN32 ? ["Git.Git", "GitHub.cli"] : ["git", "gh"];
  private static readonly ICON_FILE = join(App.DIR, IS_WIN32 ? "icon.ico" : "icon.png");
  private static readonly SHORTCUT_FILE = join(App.DIR, `${App.NAME}.lnk`);
  private static readonly DESKTOP_ENTRY_PATH = join(USER_DIR, ".local", "share", "applications");
  private static readonly DESKTOP_ENTRY_FILE = join(App.DESKTOP_ENTRY_PATH, App.NAME + ".desktop");

  private static isNewerVersion(releaseTag: string): boolean {
    const [r0 = 0, r1 = 0, r2 = 0] = releaseTag.replace(/^v/, "").split(".").map(Number);
    const [c0 = 0, c1 = 0, c2 = 0] = App.VERSION.split(".").map(Number);
    return r0 > c0 || (r0 === c0 && r1 > c1) || (r0 === c0 && r1 === c1 && r2 > c2);
  }

  private static async getConfig(): Promise<Record<string, unknown> | undefined> {
    if (!(await exists(App.CONFIG_FILE))) return;

    return await tryCatch(
      async () => {
        return JSON.parse(await readFile(App.CONFIG_FILE, "utf8"));
      },
      "Failed to read config file"
    );
  }

  private static async putConfig(data: Record<string, unknown>) {
    const existing = await App.getConfig();
    await tryCatch(
      () => {
        return writeFile(App.CONFIG_FILE, JSON.stringify({ ...(existing ?? {}), ...data }));
      },
      "Failed to write config file"
    );
  }

  private static isInstalled(pkg: string) {
    return isSuccess(() => {
      return run(IS_WIN32 ? "where" : "which" + " " + pkg, { inherit: true });
    });
  };

  private static async installGit() {
    if (await App.isInstalled("git") && await App.isInstalled("gh")) {
      return;
    }
    log("Installing dependencies...", "info");

    if (IS_WIN32) {
      if (!(await App.isInstalled("winget"))) {
        await tryCatch(
          () => {
            return retryRun(() => {
              return run(
                [
                  'powershell -Command "Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser"',
                  'powershell -Command "Install-Script winget-install -Force"',
                  'powershell -Command "winget-install"',
                ],
                { inherit: true }
              );
            });
          },
          "Winget is not installed"
        );
        if (!(await App.isInstalled("winget"))) {
          throwErr("Winget is not installed");
        }
      }

      await tryCatch(
        () => {
          return run(`winget install ${App.GIT_PACKAGES.join(" ")}`, { inherit: true });
        },
        "Git packages are not installed, this might have happened earlier",
        true
      );
    } else {
      await tryCatch(
        async () => {
          await run(sudo(`dnf install -y ${App.GIT_PACKAGES.join(" ")}`), { inherit: true });
        }, "Error while installing git"
      )
    }
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
            $Shortcut.Arguments = '-Command "Start-Process -FilePath ''${App.FILE}'' -Verb RunAs -WindowStyle Hidden"'
            $Shortcut.WorkingDirectory = '${App.DIR}'
            $Shortcut.IconLocation = '${App.ICON_FILE},0'
            $Shortcut.Description = '${App.NAME}'
            $Shortcut.Save()`.replace(/\n/g, "; ")}"`,
            { inherit: true }
          );
        });

        await copyFile(App.SHORTCUT_FILE, join(DESKTOP_DIR, basename(App.SHORTCUT_FILE)));
      } else {
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
      spawn("cmd", [
        "/c",
        `timeout /t 5 /nobreak > nul & del /f /q "${process.execPath}"`,
      ], { detached: true, stdio: "ignore", windowsHide: true }).unref();
      log(`Please restart the app with the shortcut "${App.SHORTCUT_FILE}"`, "warning")
    } else {
      await rename(process.execPath, App.FILE);
      log(`Please restart the app with the file "${App.DESKTOP_ENTRY_FILE}"`, "warning")
    }

    await Process.stop();
  }

  private static async checkUpdates() {
    await tryCatch(async () => {
      const res = await fetch(App.RELEASE_URL);
      if (!res.ok) return;

      const release = (await res.json()) as GithubRelease;
      if (!App.isNewerVersion(release.tag_name)) return;

      const assetName = IS_WIN32 ? App.NAME + ".exe" : App.NAME;
      const asset = release.assets.find(a => { return a.name === assetName; });
      if (!asset) {
        throwErr(`No download found for ${assetName} in release ${release.tag_name}`);
      }

      log(`Downloading ${release.tag_name}...`, "info");
      const dl = await fetch(asset!.browser_download_url);
      const buffer = Buffer.from(await dl.arrayBuffer());

      if (IS_WIN32) {
        await writeFile(`${App.FILE}.update`, buffer);
        spawn("cmd", [
          "/c",
          `timeout /t 5 /nobreak > nul & del /f /q "${process.execPath}" & move /y "${App.FILE}.update" "${App.FILE}"`,
        ], { detached: true, stdio: "ignore", windowsHide: true }).unref();
      } else {
        await writeFile(App.FILE, buffer);
      }

      log("Update downloaded. Restart app to apply.", "success");
      await Process.stop();
    }, "Failed to update the program");
  }

  static async setup() {
    await mkdir(App.DIR, { recursive: true });
    await App.installGit();

    await tryCatch(async () => {
      for (const field of ["name", "email"]) {
        if (!(await run(`git config --global user.${field}`))) {
          await run(`git config --global user.${field} "you@example.com"`);
        }
      }
    }, "Git initialization failed");

    await Tlauncher.install();
    await Zerotier.install();

    await App.createEntry();
    await App.moveBinnary();

    const config = await App.getConfig();
    if (config?.["installed"] !== true) {
      log("Pseudo-Server successfully installed :)", "success");
      await App.putConfig({ installed: true });
    }

    await App.checkUpdates();
  }
}
