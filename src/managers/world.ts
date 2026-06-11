import { mkdir } from "fs/promises";
import { exists, randomNum, run, log, tryCatch } from "../utils";
import { USER_NAME, SERVER_DIR } from "../constants";
import JDK from "./jdk";
import { join } from "path";


export default class World {
  private static readonly PUSH_INTERVAL_MS = 30 * 60 * 1000;
  private static readonly MC_FUNC_CHAT_SYNC_NAME = "-s:chat-w-sync";
  private static readonly DIR = join(SERVER_DIR, "world");
  private static readonly REPO_URL = "TEST"

  private static _initialized = false;
  private static _nodePushInterval: NodeJS.Timeout;

  static get initialized() {
    return this._initialized;
  }
  static get nodePushInterval() {
    return this._nodePushInterval;
  }

  static async init() {
    await tryCatch(async () => {
      if (await exists(World.DIR)) {
        await World.sync();
      }
      else {
        log("World initialization...", "info");
        await mkdir(World.DIR, { recursive: true });
        await run(
          [
            "git init -b main",
            "git config --add safe.directory .",
            `git -c credential.helper= fetch --depth 1 ${World.REPO_URL} main`,
            "git reset --hard FETCH_HEAD",
          ],
          { inherit: true, cwd: World.DIR }
        );
      }
      await run(
        ["git reflog expire --expire=now --all", "git gc --prune=now"],
        { cwd: World.DIR }
      );
      World._initialized = true;
    }, "Error during Minecraft world initialization");
  }

  static enableRepeatedPush() {
    World._nodePushInterval = setInterval(async () => {
      await World.push();
      log("The world has been sent to the cloud", "warning");
    }, World.PUSH_INTERVAL_MS);
  }

  static disableRepeatedPush() {
    clearInterval(World._nodePushInterval)
  }

  static async push() {
    await tryCatch(async () => {
      await run(
        [
          "git add -A",
          `git commit -m "${USER_NAME + randomNum(6)}-update"`,
          `git push -f ${World.REPO_URL} --all`,
        ],
        { inherit: true, cwd: World.DIR }
      );
      JDK.runMCCommand(`/function ${World.MC_FUNC_CHAT_SYNC_NAME}`);
    }, "Error sending world to the cloud (check your internet)");
  };

  static async sync() {
    log("World synchronization...", "info");
    await tryCatch(async () => {
      await run(`git -c credential.helper= fetch --depth 1 ${World.REPO_URL}`, {
        inherit: true,
        cwd: World.DIR,
      });
      const unstagedCommits = await run("git status --porcelain", { cwd: World.DIR });
      const [localHead, remoteHead] = await run([
        "git rev-parse HEAD",
        "git rev-parse FETCH_HEAD"
      ], { cwd: World.DIR });

      if (unstagedCommits.length !== 0 && localHead === remoteHead) {
        await World.push();
      } else {
        await run("git reset --hard FETCH_HEAD", { inherit: true, cwd: World.DIR });
      }
    }, "Failed world synchronization");
  };
}
