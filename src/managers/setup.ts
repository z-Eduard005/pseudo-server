import { createInterface } from "readline";
import { join } from "path";
import { copyFile, writeFile, rm } from "fs/promises";
import {
  IS_WIN32,
  CUSTOM_VERSION_DIR,
  WINGET_PACKAGES,
  SERVER_NAME,
  SHORTCUT_FILE,
  SHORTCUT_FILENAME,
  ICON_FILE,
  DESKTOP_DIR,
  DESKTOP_ENTRY_PATH,
} from "../constants";
import { exists, run, isWingetInstalled, retryRun, log, color, throwErr, tryCatch, putConfig, getConfig } from "../utils";
import Zerotier from "./zerotier";
import JDK from "./jdk";
import Tlauncher from "./tlauncher";
import Process from "./process";
import App from "./app";

export default class Setup {
  static async ensure() {
    if ((await getConfig())?.["installed"]) {
      return;
    }

    log("First launch — installing dependencies...", "info");

    await Process.init();

    await Tlauncher.install();

    await Zerotier.install();

    if (await exists(CUSTOM_VERSION_DIR)) {
      const answer = await new Promise<string>((resolve) => {
        const rl = createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        rl.question(
          color(
            "Some server files already installed\nWant to reinstall? (y/n)\n(ALL YOUR IN-GAME SETTINGS WILL BE LOST!)\n> ",
            "warning"
          ),
          (input) => {
            rl.close();
            resolve(input.trim().toLowerCase());
          }
        );
      });

      if (answer !== "y") {
        return;
      }
      await rm(CUSTOM_VERSION_DIR, { recursive: true, force: true });
    }

    log("Installing necessary packages...", "info");
    if (IS_WIN32) {
    await retryRun(() => {
      return run(
        'powershell -Command "Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser"',
        { inherit: true }
      );
    });

      if (!(await isWingetInstalled())) {
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
        if (!(await isWingetInstalled())) {
          throwErr("Winget is not installed");
        }
      }

      await tryCatch(
        () => {
          return run(`winget install ${WINGET_PACKAGES.join(" ")}`, { inherit: true });
        },
        "Some packages are not installed, this might have happened earlier",
        true
      );
    } else {
      await JDK.linuxInstall();
    }

    await App.install();

    await tryCatch(async () => {
      if (IS_WIN32) {
        await retryRun(() => {
          return run(
            `powershell -Command "${`
            $WshShell = New-Object -ComObject WScript.Shell
            $Shortcut = $WshShell.CreateShortcut('${SHORTCUT_FILE}')
            $Shortcut.TargetPath = 'powershell'
            $Shortcut.Arguments = '-Command "Start-Process -FilePath ''${App.START_SERVER_FILE}'' -Verb RunAs -WindowStyle Hidden"'
            $Shortcut.WorkingDirectory = '${CUSTOM_VERSION_DIR}'
            $Shortcut.IconLocation = '${ICON_FILE},0'
            $Shortcut.Description = '${SERVER_NAME}'
            $Shortcut.Save()`.replace(/\n/g, "; ")}"`,
            { inherit: true }
          );
        });

        await copyFile(SHORTCUT_FILE, join(DESKTOP_DIR, SHORTCUT_FILENAME));
      } else {
        await writeFile(
          join(DESKTOP_ENTRY_PATH, SERVER_NAME + ".desktop"),
          `[Desktop Entry]
          Name=${SERVER_NAME}
          Exec=ptyxis -- /bin/bash -lc "DRI_PRIME=1 ${App.START_SERVER_FILE}"
          Type=Application
          Terminal=false
          Icon=${ICON_FILE}
          Categories=Application;`,
          "utf8"
        );
        await run(`update-desktop-database ${DESKTOP_ENTRY_PATH}`, {
          inherit: true,
        });
      }
    }, `Failed to create a shortcut for ${SERVER_NAME}\nTry to reinstall by launching this installer again (ALL YOUR IN-GAME SETTINGS WILL BE LOST)`);

    await putConfig({ installed: true });
    log("Server successfully installed :)", "success");
  }
}
