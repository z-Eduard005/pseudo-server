import { IS_WIN32, USER_DIR } from "../constants";
import { color, isSuccess, log, run, throwErr, tryCatch } from "../utils";
import { createInterface } from "readline";
import Zerotier from "./zerotier";
import Git from "./git";
import JDK from "./jdk";
import Hosting from "./hosting";
import UI from "./ui";

export default class Process {
  private static closing = false;

  private static async ensureAdmin() {
    const isAdmin = await isSuccess(async () => await run("net session"));
    if (isAdmin) return;

    throwErr(`You don't have admin rights!\nPlease start the program as an admin`);
  }

  private static async isFedora() {
    return await tryCatch(
      async () => {
        const osRelease = await run("cat /etc/os-release");
        return osRelease.toLowerCase().includes("id=fedora");
      }, "Error checking OS type"
    );
  }

  static async init() {
    process.chdir(USER_DIR);

    if (IS_WIN32) {
      await Process.ensureAdmin();
    } else if (await Process.isFedora()) {
      await run("sudo -v", { inherit: true });
    } else {
      throwErr("Apologies, this program currently only works on Windows or Fedora Linux.");
    }

    process.on("uncaughtException", err => {
      UI.restoreMainScreen();
      throwErr("Uncaught Exception: " + err);
    });
    process.on("unhandledRejection", reason => {
      UI.restoreMainScreen();
      throwErr("Unhandled Rejection: " + reason);
    });

    const { emitWarning } = process;
    process.emitWarning = (warning, ...args) => {
      if (args[0] === 'ExperimentalWarning') return;
      return emitWarning(warning, ...args as (NodeJS.EmitWarningOptions | undefined)[]);
    };
  };

  static async pause() {
    await new Promise<void>(async (resolve) => {
      await tryCatch(() => {
        const rl = createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        rl.question(color("Press button to continue...", "warning"), () => {
          rl.close();
          resolve();
        });
      }, "Error while pausing the app", true);
    });
  }

  static async stop(successLog?: string) {
    if (Process.closing) return;
    Process.closing = true;
    UI.restoreMainScreen();

    Git.worldDisableRepeatedPush();
    await JDK.kill();

    if (Hosting.ip === Zerotier.ip && Git.worldInitialized) {
      await tryCatch(
        () => Git.worldSync(),
        err => log(err, "error")
      );
    }
    Hosting.disableKeepAlive();

    await Zerotier.leaveNetwork();

    if (successLog) log(successLog, "success");

    await Process.pause();
    try { process.stdin.setRawMode(false); } catch { }
    process.exit(0);
  }
}
