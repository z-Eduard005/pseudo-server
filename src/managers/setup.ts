import { join } from "path";
import { copyFile, writeFile } from "fs/promises";
import {
  IS_WIN32,
  DESKTOP_ENTRY_PATH,
  APP_DIR,
  APP_NAME,
  DESKTOP_DIR,
  APP_FILE,
} from "../constants";
import { run, retryRun, log, throwErr, tryCatch, putConfig, getConfig, isSuccess, sudo } from "../utils";
import Zerotier from "./zerotier";
import Tlauncher from "./tlauncher";

export default class Setup {
  private static readonly DEFAULT_LINUX_TERM = "ptyxis";
  private static readonly WINGET_PACKAGES = ["Git.GH", "Git.Git"];
  private static readonly ICON_FILE = join(
    APP_DIR,
    IS_WIN32 ? "icon.ico" : "icon.png"
  );
  private static readonly SHORTCUT_FILENAME = `${APP_NAME}.lnk`;
  private static readonly SHORTCUT_FILE = join(APP_DIR, Setup.SHORTCUT_FILENAME);

  private static isWingetInstalled() {
    return isSuccess(() => {
      return run("where winget", { inherit: true });
    });
  };

  private static async installGit() {
    if (IS_WIN32) {
      await retryRun(() => {
        return run(
          'powershell -Command "Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser"',
          { inherit: true }
        );
      });

      if (!(await Setup.isWingetInstalled())) {
        await tryCatch(
          () => {
            return retryRun(() => {
              return run(
                [
                  'powershell -Command "Install-Script winget-install -Force"',
                  'powershell -Command "winget-install"',
                ],
                { inherit: true }
              );
            });
          },
          "Winget is not installed"
        );
        if (!(await Setup.isWingetInstalled())) {
          throwErr("Winget is not installed");
        }
      }

      await tryCatch(
        () => {
          return run(`winget install ${Setup.WINGET_PACKAGES.join(" ")}`, { inherit: true });
        },
        "Git packages are not installed, this might have happened earlier",
        true
      );
    } else {
      await tryCatch(
        async () => {
          await run(sudo("dnf install git gh"));
        }, "Error while installing git"
      )
    }

    log("Initializing git credentials...", "info");
    await tryCatch(async () => {
      for (const field of ["name", "email"]) {
        if (!(await run(`git config --global user.${field}`))) {
          await run(`git config --global user.${field} "you@example.com"`);
        }
      }
    }, "Git initialization failed");
  }

  private static async createEntry() {
    return await tryCatch(async () => {
      if (IS_WIN32) {
        await retryRun(() => {
          return run(
            `powershell -Command "${`
            $WshShell = New-Object -ComObject WScript.Shell
            $Shortcut = $WshShell.CreateShortcut('${Setup.SHORTCUT_FILE}')
            $Shortcut.TargetPath = 'powershell'
            $Shortcut.Arguments = '-Command "Start-Process -FilePath ''${APP_FILE}'' -Verb RunAs -WindowStyle Hidden"'
            $Shortcut.WorkingDirectory = '${APP_DIR}'
            $Shortcut.IconLocation = '${Setup.ICON_FILE},0'
            $Shortcut.Description = '${APP_NAME}'
            $Shortcut.Save()`.replace(/\n/g, "; ")}"`,
            { inherit: true }
          );
        });

        await copyFile(Setup.SHORTCUT_FILE, join(DESKTOP_DIR, Setup.SHORTCUT_FILENAME));
      } else {
        await writeFile(
          join(DESKTOP_ENTRY_PATH, APP_NAME + ".desktop"),
          `[Desktop Entry]
          Name=${APP_NAME}
          Exec=${Setup.DEFAULT_LINUX_TERM} -- /bin/bash -lc "DRI_PRIME=1 ${APP_FILE}"
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
    }, `Failed to create a shortcut for ${APP_NAME}\nTry again`);
  }

  static async ensure() {
    const config = await getConfig();
    if (config?.["installed"]) {
      return;
    }
    log("First launch — installing dependencies...", "info");

    await Tlauncher.install();
    await Zerotier.install();

    await Setup.installGit();

    await Setup.createEntry();

    await putConfig({ installed: true });
    log("Server successfully installed :)", "success");
  }
}
