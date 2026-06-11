import { spawn } from "child_process";
import { IS_WIN32, USER_DIR } from "../constants";
import { color, isSuccess, log, run, throwErr, tryCatch } from "../utils";
import { createInterface } from "readline";
import Zerotier from "./zerotier";
import World from "./world";
import JDK from "./jdk";
import Hosting from "./hosting";

export default class Process {
  private static closing = false;

  private static async ensureAdmin() {
    await tryCatch(async () => {
      if (await isSuccess(() => {
        return run("net session");
      })) {
        return;
      }
      spawn(
        "powershell",
        ["-Command", `Start-Process "${process.execPath}" -Verb RunAs`],
        {
          detached: true,
          stdio: "ignore",
        }
      ).unref();

      // await setTimeoutPromise(5000);
      await Process.stop();
    }, "You don't have admin rights! Please try again...");
  }

  static async init() {
    process.chdir(USER_DIR);
    if (IS_WIN32) {
      await Process.ensureAdmin();
    } else {
      await run("sudo -v", { inherit: true });
    }

    process.on("uncaughtException", (err) => {
      return throwErr("Uncaught Exception: " + err);
    });
    process.on("unhandledRejection", (reason) => {
      return throwErr("Unhandled Rejection: " + reason);
    });
  };

  static async pause() {
    await new Promise<void>((resolve) => {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      rl.question(color("Press button to continue...", "warning"), () => {
        rl.close();
        resolve();
      });
    });
  }

  static async stop(successLog?: string) {
    if (Process.closing) {
      return;
    }
    Process.closing = true;

    World.disableRepeatedPush();
    await JDK.kill();

    if (Hosting.ip === Zerotier.ip && World.initialized) {
      await tryCatch(
        () => {
          return World.sync();
        },
        (err) => {
          return log(err, "error");
        }
      );
    }
    Hosting.disableKeepAlive();

    await Zerotier.leaveNetwork();

    if (successLog) {
      log(successLog, "success");
    }

    await Process.pause();
    process.exit(0);
  }
}
