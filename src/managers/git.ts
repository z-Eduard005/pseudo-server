import { readFile, rm, writeFile } from "fs/promises";
import { exists, randomNum, run, log, tryCatch } from "../utils";
import { USER_NAME, INSTANCES_DIR, CONFIG_FILE } from "../constants";
import { join } from "path";
import GH from "./gh";
import App, { type Instance } from "./app";

export default class Git {
  private static readonly PUSH_INTERVAL_MS = 30 * 60 * 1000;
  private static readonly REPO_URL = "TEST"

  static worldInitialized = false;
  static nodeWorldPushInterval: NodeJS.Timeout;

  static async initServer(serverName: string) {
    const serverDir = join(INSTANCES_DIR, serverName, "server");
    const deployKeyPath = join(INSTANCES_DIR, serverName, "deploy_key");
    const posixPath = deployKeyPath.replace(/\\/g, "/");

    await tryCatch(async () => {
      // 0: remove previous failures
      await rm(join(serverDir, ".git"), { recursive: true, force: true });
      // 1: add to gitignore
      await writeFile(join(serverDir, ".gitignore"), "/world/\n");
      // 2: git init for server dir on branch "server"
      await run("git init -b server", { cwd: serverDir });

      // Generate SSH deploy key pair
      await rm(deployKeyPath, { force: true });
      await rm(deployKeyPath + ".pub", { force: true });
      await run(`ssh-keygen -t ed25519 -N "" -f "${posixPath}"`);

      // 3: create repo with gh and save to config
      const repoUrl = await GH.repoCreate(serverName);
      const pubKey = await readFile(deployKeyPath + ".pub", "utf8");
      await GH.addDeployKey(serverName, pubKey.trim());

      // Set up remote + commit init
      await run(
        [
          `git remote add origin ${repoUrl}`,
          "git add -A",
          'git commit -m "init"'
        ],
        { cwd: serverDir }
      );
      process.env['GIT_SSH_COMMAND'] = `ssh -o StrictHostKeyChecking=accept-new -i ${posixPath}`;
      await run("git push --force origin server", { cwd: serverDir, inherit: true });

      // Save repoUrl to instance config
      const config = await App.getConfig(CONFIG_FILE);
      const instances = (config["instances"] as Instance[]) ?? [];
      const inst = instances.find(i => i.name === serverName);
      if (inst) inst.repoUrl = repoUrl;
      await App.putConfig(CONFIG_FILE, { instances });
    }, "Error during server directory initialization");
  }

  static async initWorld(serverName: string) {
    const serverDir = join(INSTANCES_DIR, serverName, "server");
    const worldDir = join(serverDir, "world");

    await tryCatch(async () => {
      // 0: remove previous failures
      await rm(join(worldDir, ".git"), { recursive: true, force: true });
      // 2: git init for world dir on branch "world" 
      // TODO 
      // 3: create repo with gh for world dir and save token to config
      // TODO
      // 4: push world dir with token
      // TODO




      // BACKUP: DONT DELETE
      // log("World initialization...", "info");
      // await mkdir(worldDir, { recursive: true });
      // await run(
      //   [
      //     "git init -b world",
      //     "git config --add safe.directory .",
      //     `git -c credential.helper= fetch --depth 1 ${Git.REPO_URL} world`,
      //     "git reset --hard FETCH_HEAD",
      //   ],
      //   { inherit: true, cwd: worldDir }
      // );
      // Git.worldInitialized = true;
    }, "Error during world directory initialization");
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

  static async serverFetch(repoUrl: string, deployKeyPath: string) {
    log("Server synchronization...", "info");
    await tryCatch(async () => {
      const posixPath = deployKeyPath.replace(/\\/g, "/");
      process.env['GIT_SSH_COMMAND'] = `ssh -o StrictHostKeyChecking=accept-new -i ${posixPath}`;
      if (!(await exists(Git.SERVER_DIR))) {
        // TODO
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

  static async serverPush(_repoUrl: string, deployKeyPath: string) {
    const posixPath = deployKeyPath.replace(/\\/g, "/");
    await tryCatch(async () => {
      process.env['GIT_SSH_COMMAND'] = `ssh -o StrictHostKeyChecking=accept-new -i ${posixPath}`;
      await run(
        [
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
