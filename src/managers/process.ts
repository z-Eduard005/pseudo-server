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
    const isAdmin = await isSuccess(() => run("net session"));
    if (isAdmin) return;

    throwErr(`You don't have admin rights!\nPlease start the program as an admin`)
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
      throwErr("Sorry, this program works only on Windows or Fedora Linux")
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
