import { join, basename } from "path";
import { copyFile, readFile, writeFile } from "fs/promises";
import {
  IS_WIN32,
  DESKTOP_ENTRY_PATH,
  DESKTOP_DIR,
  LINUX_SHELL,
  USER_DIR,
} from "../constants";
import { run, retryRun, log, throwErr, tryCatch, isSuccess, sudo, exists } from "../utils";
import Zerotier from "./zerotier";
import Tlauncher from "./tlauncher";

export default class App {
  // private static readonly VERSION = "0.0.0";
  // private static readonly GITHUB = "z-Eduard005/pseudo-server";
  private static readonly DIR = IS_WIN32 ? join(USER_DIR, "AppData", "Roaming", "pseudo-server") : join(USER_DIR, ".config", "pseudo-server");
  private static readonly NAME = "Pseudo-Server";
  private static readonly FILE = join(App.DIR, IS_WIN32 ? App.NAME + ".exe" : App.NAME);
  private static readonly CONFIG_FILE = join(App.DIR, "config.json");

  private static readonly DEFAULT_LINUX_TERM = "ptyxis";
  private static readonly GIT_PACKAGES = IS_WIN32 ? ["Git.Git", "GitHub.cli"] : ["git", "gh"];
  private static readonly ICON_FILE = join(App.DIR, IS_WIN32 ? "icon.ico" : "icon.png");
  private static readonly SHORTCUT_FILE = join(App.DIR, `${App.NAME}.lnk`);
  private static readonly RAW_GITHUB_URL = "https://raw.githubusercontent.com/z-Eduard005/pseudo-server/main";

  static async getConfig(): Promise<Record<string, unknown> | undefined> {
    if (!(await exists(App.CONFIG_FILE))) return;

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

  private static isInstalled(pkg: string) {
    return isSuccess(() => {
      return run(IS_WIN32 ? "where" : "which" + pkg, { inherit: true });
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
          join(DESKTOP_ENTRY_PATH, App.NAME + ".desktop"),
          `[Desktop Entry]
          Name=${App.NAME}
          Exec=${App.DEFAULT_LINUX_TERM} -- ${LINUX_SHELL} -lc "DRI_PRIME=1 ${App.FILE}"
          Type=Application
          Terminal=false
          Icon=${App.ICON_FILE}
          Categories=Application;`,
          "utf8"
        );
        await run(`update-desktop-database ${DESKTOP_ENTRY_PATH}`, {
          inherit: true,
        });
      }
    }, `Failed to create a shortcut for ${App.NAME}\nTry again`);
  }

  static async setup() {
    await Tlauncher.install();
    await Zerotier.install();

    await App.installGit();

    log("Initializing git credentials...", "info");
    await tryCatch(async () => {
      for (const field of ["name", "email"]) {
        if (!(await run(`git config --global user.${field}`))) {
          await run(`git config --global user.${field} "you@example.com"`);
        }
      }
    }, "Git initialization failed");

    await App.createEntry();

    const config = await App.getConfig();
    if (config?.["installed"] !== true) {
      log("Server successfully installed :)", "success");
      await App.putConfig({ installed: true });
    }
  }

  // static async ensureInstallation() {
  //   if (!process.pkg) return;
  //   const currentPath = normalize(process.execPath).toLowerCase();
  //   const appFile = normalize(App.FILE).toLowerCase();
  //   if (currentPath === appFile) return;

  //   await tryCatch(async () => {
  //     await mkdir(App.DIR, { recursive: true });
  //     await copyFile(process.execPath, App.FILE);

  //     if (IS_WIN32) {
  //       spawn("cmd", [
  //         "/c",
  //         `timeout /t 3 /nobreak > nul & del /f /q "${process.execPath}" & start "" /min "${App.FILE}"`,
  //       ], { detached: true, stdio: "ignore" });
  //     } else {
  //       unlink(process.execPath).catch(() => { });
  //       spawn(App.FILE, process.argv.slice(1), { stdio: "inherit" });
  //     }
  //     process.exit(0);
  //   }, "Failed to install app");
  // }

  // static async checkForUpdates() {
  //   await tryCatch(async () => {
  //     const updateFile = App.FILE + ".update";
  //     if (await exists(updateFile)) {
  //       await copyFile(updateFile, App.FILE);
  //       await unlink(updateFile);
  //       log("Update applied. Restarting...", "info");
  //       spawn(App.FILE, process.argv.slice(1), { stdio: "inherit" });
  //       process.exit(0);
  //     }

  //     const res = await fetch(`https://api.github.com/repos/${App.GITHUB}/releases/latest`);
  //     if (!res.ok) return;

  //     const data = (await res.json()) as { tag_name: string; assets: Array<{ name: string; browser_download_url: string }> };
  //     const latestTag = data.tag_name;
  //     if (latestTag.replace(/^v/, "") === App.VERSION) return;

  //     const assetName = IS_WIN32 ? App.NAME + ".exe" : App.NAME;
  //     const asset = data.assets.find(a => a.name === assetName);
  //     if (!asset) {
  //       log(`No download found for ${assetName} in release ${latestTag}`, "warning");
  //       return;
  //     }

  //     log(`Downloading ${latestTag}...`, "info");
  //     const dl = await fetch(asset.browser_download_url);
  //     const buffer = Buffer.from(await dl.arrayBuffer());

  //     if (IS_WIN32) {
  //       await writeFile(updateFile, buffer);
  //       log(`Update ${latestTag} downloaded. Restart app to apply.`, "success");
  //     } else {
  //       await writeFile(App.FILE, buffer);
  //       log(`Updated to ${latestTag}. Restarting...`, "success");
  //       spawn(App.FILE, process.argv.slice(1), { stdio: "inherit" });
  //       process.exit(0);
  //     }
  //   }, "Failed to check for updates", true);
  // }
}
