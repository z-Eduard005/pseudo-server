import { join, basename } from "path";
import { copyFile, writeFile } from "fs/promises";
import {
  IS_WIN32,
  DESKTOP_ENTRY_PATH,
  DESKTOP_DIR,
  LINUX_SHELL,
} from "../constants";
import { run, retryRun, log, throwErr, tryCatch, isSuccess, sudo, exists } from "../utils";
import Zerotier from "./zerotier";
import Tlauncher from "./tlauncher";
import App from "./app";

export default class Setup {
  private static readonly DEFAULT_LINUX_TERM = "ptyxis";
  private static readonly GIT_PACKAGES = IS_WIN32 ? ["Git.Git", "GitHub.cli"] : ["git", "gh"];
  private static readonly ICON_FILE = join(App.DIR, IS_WIN32 ? "icon.ico" : "icon.png");
  private static readonly SHORTCUT_FILE = join(App.DIR, `${App.NAME}.lnk`);
  private static readonly RAW_GITHUB_URL = "https://raw.githubusercontent.com/z-Eduard005/pseudo-server/main";

  private static isInstalled(pkg: string) {
    return isSuccess(() => {
      return run(IS_WIN32 ? "where" : "which" + pkg, { inherit: true });
    });
  };

  private static async installGit() {
    if (await Setup.isInstalled("git") && await Setup.isInstalled("gh")) return;
    log("Installing dependencies...", "info");

    if (IS_WIN32) {
      if (!(await Setup.isInstalled("winget"))) {
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
        if (!(await Setup.isInstalled("winget"))) {
          throwErr("Winget is not installed");
        }
      }

      await tryCatch(
        () => {
          return run(`winget install ${Setup.GIT_PACKAGES.join(" ")}`, { inherit: true });
        },
        "Git packages are not installed, this might have happened earlier",
        true
      );
    } else {
      await tryCatch(
        async () => {
          await run(sudo(`dnf install -y ${Setup.GIT_PACKAGES.join(" ")}`), { inherit: true });
        }, "Error while installing git"
      )
    }
  }

  private static async createEntry() {
    return await tryCatch(async () => {
      if (!(await exists(Setup.ICON_FILE))) {
        await run(
          `curl -fsSL ${Setup.RAW_GITHUB_URL}/assets/${basename(Setup.ICON_FILE)} -o "${Setup.ICON_FILE}"`,
          { inherit: true }
        );
      }

      if (IS_WIN32 && !(await exists(Setup.SHORTCUT_FILE))) {
        await retryRun(() => {
          return run(
            `powershell -Command "${`
            $WshShell = New-Object -ComObject WScript.Shell
            $Shortcut = $WshShell.CreateShortcut('${Setup.SHORTCUT_FILE}')
            $Shortcut.TargetPath = 'powershell'
            $Shortcut.Arguments = '-Command "Start-Process -FilePath ''${App.FILE}'' -Verb RunAs -WindowStyle Hidden"'
            $Shortcut.WorkingDirectory = '${App.DIR}'
            $Shortcut.IconLocation = '${Setup.ICON_FILE},0'
            $Shortcut.Description = '${App.NAME}'
            $Shortcut.Save()`.replace(/\n/g, "; ")}"`,
            { inherit: true }
          );
        });

        await copyFile(Setup.SHORTCUT_FILE, join(DESKTOP_DIR, basename(Setup.SHORTCUT_FILE)));
      } else {
        await writeFile(
          join(DESKTOP_ENTRY_PATH, App.NAME + ".desktop"),
          `[Desktop Entry]
          Name=${App.NAME}
          Exec=${Setup.DEFAULT_LINUX_TERM} -- ${LINUX_SHELL} -lc "DRI_PRIME=1 ${App.FILE}"
          Type=Application
          Terminal=false
          Icon=${Setup.ICON_FILE}
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

    await Setup.installGit();

    log("Initializing git credentials...", "info");
    await tryCatch(async () => {
      for (const field of ["name", "email"]) {
        if (!(await run(`git config --global user.${field}`))) {
          await run(`git config --global user.${field} "you@example.com"`);
        }
      }
    }, "Git initialization failed");

    await Setup.createEntry();

    const config = await App.getConfig();
    if (config?.["installed"] !== true) {
      log("Server successfully installed :)", "success");
      await App.putConfig({ installed: true });
    }
  }
}
