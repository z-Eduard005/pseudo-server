import { CUSTOM_VERSION_DIR, IS_WIN32, SERVER_NAME } from "../constants";
import { run, log, tryCatch } from "../utils";
import { join } from "path";

export default class App {
  private static readonly _START_SERVER_FILE = join(CUSTOM_VERSION_DIR, IS_WIN32 ? SERVER_NAME + ".exe" : SERVER_NAME);

  static get START_SERVER_FILE() {
    return this._START_SERVER_FILE;
  }

  // private static async update() {
  //   log(`${SERVER_NAME} will be updated now...`, 'warning');
  //   await Process.pause();

  //   // TODO: logic 

  //   await Process.stop();
  // }

  private static async gitInit() {
    let logged: boolean;
    await tryCatch(async () => {
      for (const field of ["name", "email"]) {
        if (!(await run(`git config --global user.${field}`))) {
          if (!logged) {
            log("Initializing git credentials...", "info");
            logged = true;
          }
          await run(`git config --global user.${field} "you@example.com"`);
        }
      }
    }, "Git initialization failed");
  }

  static async checkForUpdates() {
    log("Checking for updates...", "info");
    await tryCatch(async () => {
      // TODO: logic
    }, "Updates check failed");
  }

  static async install() {
    log("Installing server files...", "info");
    await App.gitInit();

    await tryCatch(async () => {
      // TODO: logic
    }, "Server files not installed! Please try again...");
  }
}
