import { mkdir, writeFile } from "fs/promises";
import { exists, randomNum, run, log, tryCatch } from "../utils";
import { USER_NAME } from "../constants";
import JDK from "./jdk";
import { join } from "path";

const INSTANCE_DIR = "TEST";

export default class Git {
  private static readonly PUSH_INTERVAL_MS = 30 * 60 * 1000;
  private static readonly MC_FUNC_CHAT_SYNC_NAME = "-s:chat-w-sync";
  private static readonly SERVER_DIR = join(INSTANCE_DIR, "server");
  private static readonly WORLD_DIR = join(Git.SERVER_DIR, "world");
  private static readonly REPO_URL = "TEST"

  static worldInitialized = false;
  static nodeWorldPushInterval: NodeJS.Timeout;

  // ───────── World methods ─────────

  static async worldInit() {
    await tryCatch(async () => {
      await writeFile(join(Git.SERVER_DIR, ".gitignore"), "world/\n",);

      if (await exists(Git.WORLD_DIR)) {
        await Git.worldSync();
      } else {
        log("World initialization...", "info");
        await mkdir(Git.WORLD_DIR, { recursive: true });
        await run(
          [
            "git init -b world",
            "git config --add safe.directory .",
            `git -c credential.helper= fetch --depth 1 ${Git.REPO_URL} world`,
            "git reset --hard FETCH_HEAD",
          ],
          { inherit: true, cwd: Git.WORLD_DIR }
        );
      }
      Git.worldInitialized = true;
    }, "Error during Minecraft world initialization");
  }

  static worldEnableRepeatedPush() {
    Git.nodeWorldPushInterval = setInterval(async () => {
      await Git.worldPush();
      log("The world has been sent to the cloud", "warning");
    }, Git.PUSH_INTERVAL_MS);
  }

  static worldDisableRepeatedPush() {
    clearInterval(Git.nodeWorldPushInterval)
  }

  static async worldPush() {
    await tryCatch(async () => {
      await run(
        [
          "git add -A",
          `git commit -m "${USER_NAME + randomNum(6)}-update"`,
          `git push -f ${Git.REPO_URL} --all`,
        ],
        { inherit: true, cwd: Git.WORLD_DIR }
      );
      JDK.runMCCommand(`/function ${Git.MC_FUNC_CHAT_SYNC_NAME}`);
    }, "Error sending world to the cloud (check your internet)");
  };

  static async worldSync() {
    log("World synchronization...", "info");
    await tryCatch(async () => {
      await run(`git -c credential.helper= fetch --depth 1 ${Git.REPO_URL}`, {
        inherit: true,
        cwd: Git.WORLD_DIR,
      });
      const unstagedChanges = await run("git status --porcelain", { cwd: Git.WORLD_DIR });
      const [localHead, remoteHead] = await run(
        ["git rev-parse HEAD", "git rev-parse FETCH_HEAD"],
        { cwd: Git.WORLD_DIR }
      );

      if (unstagedChanges.length !== 0 && localHead === remoteHead) {
        await Git.worldPush();
      } else {
        await run("git reset --hard FETCH_HEAD", { inherit: true, cwd: Git.WORLD_DIR });
      }
    }, "Failed world synchronization");
  };

  // ───────── Server methods ─────────

  private static async serverDirSetup(repoUrl: string, deployKeyPath: string) {
    await run(
      [
        "git init -b server",
        `git remote add origin ${repoUrl}`,
        `git config core.sshCommand "ssh -i ${deployKeyPath}"`,
      ],
      { inherit: true, cwd: Git.SERVER_DIR }
    );
  }

  static async serverInit(repoUrl: string, deployKeyPath: string) {
    await tryCatch(async () => {
      await mkdir(Git.SERVER_DIR, { recursive: true });
      await Git.serverDirSetup(repoUrl, deployKeyPath);
      await run(
        [
          "git add -A",
          'git commit -m "init"',
          "git push --force origin server",
        ],
        { inherit: true, cwd: Git.SERVER_DIR }
      );
    }, "Failed to initialize server repository");
  }

  static async serverFetch(repoUrl: string, deployKeyPath: string) {
    log("Server synchronization...", "info");
    await tryCatch(async () => {
      if (!(await exists(Git.SERVER_DIR))) {
        await mkdir(Git.SERVER_DIR, { recursive: true });
        await Git.serverDirSetup(repoUrl, deployKeyPath);
      }
      await run(
        [
          "git fetch --depth 1 origin server",
          "git reset --hard origin/server",
        ],
        { inherit: true, cwd: Git.SERVER_DIR }
      );
    }, "Failed server synchronization");
  }

  static async serverPush(repoUrl: string, deployKeyPath: string) {
    await tryCatch(async () => {
      await run(
        [
          `git config core.sshCommand "ssh -i ${deployKeyPath}"`,
          "git add -A",
          'git commit --amend -m "snapshot"',
          "git push --force origin server",
        ],
        { inherit: true, cwd: Git.SERVER_DIR }
      );
    }, "Failed to push server updates");
  }

  static async serverDetectDirty() {
    return await tryCatch(async () => {
      const status = await run("git status --porcelain", { cwd: Git.SERVER_DIR });
      return status.trim().length > 0;
    }, "Failed to check server status");
  }
}
