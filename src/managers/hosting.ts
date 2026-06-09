import { join } from "path";
import { DEFAULT_START_ZT_IP, CUSTOM_VERSION_DIR, IS_WIN32, MC_PORT, SERVER_NAME, VERCEL_API_PASS, HOSTING_STALE_MS } from "../constants";
import { exists, log, retryRun, run, throwErr, tryCatch } from "../utils";
import { readFile, rename } from "fs/promises";
import { setTimeout as setTimeoutPromise } from "timers/promises";
import Zerotier from "./zerotier";

type ServerStatus = {
  ip: string | null;
  lastUpdateTime: number | null;
  err: string | null;
};

export default class Hosting {
  private static readonly URL = "https://server-status-iota.vercel.app/";
  private static readonly ACTIVATE_INTERVAL_MS = 25 * 1000;
  private static readonly ACTIVATION_LIMIT = 5 * 60 * 1000 / Hosting.ACTIVATE_INTERVAL_MS;
  private static readonly MC_LOG_FILE = join(CUSTOM_VERSION_DIR, "logs", "latest.log");
  private static readonly MC_LOG_EVENTS = [
    // mc client loaded
    "] [Client thread/INFO] [FML]: Forge Mod Loader has successfully loaded",
    // trying to connect to the server
    `] [Client thread/INFO] [net.minecraft.client.multiplayer.GuiConnecting]: Connecting to ${DEFAULT_START_ZT_IP}`,
    // server closed
    "] [Client thread/INFO] [FML]: Holder lookups applied",
    // pressed multiplayer button first time
    "] [Session-Validator/INFO] [ReAuth]: Session validation successful",
  ];

  static status: ServerStatus = { ip: null, lastUpdateTime: null, err: null };
  private static someonePlaing = false;
  private static _nodePushInterval: NodeJS.Timeout;

  static get nodePushInterval() {
    return this._nodePushInterval;
  }

  private static async activateServer() {
    return await tryCatch(async () => {
      const result = await retryRun(async () => {
        const res = await fetch(Hosting.URL + "activate", {
          method: "POST",
          headers: {
            "x-api-password": VERCEL_API_PASS,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ipv4: Zerotier.ip }),
        });
        return await res.json() as ServerStatus;
      });
      if (result.err) {
        throwErr(result.err);
      }
      return result;
    }, `Server connection error (check your internet)\nNext launch possible in ${Hosting.ACTIVATE_INTERVAL_MS / 1000 + 10} seconds`);
  }

  private static async getStatus() {
    return retryRun(async () => {
      const res = await fetch(Hosting.URL + "get", {
        headers: { "x-api-password": VERCEL_API_PASS },
      });
      return await res.json() as ServerStatus;
    });
  }

  private static async isUserConnected() {
    return await tryCatch(
      async () => {
        const netstat = await retryRun(() => {
          return run(
            IS_WIN32
              ? "netstat -ano | findstr ESTABLISHED 2>nul"
              : "lsof -iTCP -sTCP:ESTABLISHED -n -P | grep javaw | xargs -r"
          );
        });
        return netstat.includes(`${Hosting.status.ip}:${MC_PORT}`);
      },
      "Error checking user connection to minecraft server"
    );
  }

  private static hasRecentActivity(lines: string[], lastLineIndex: number) {
    return Hosting.MC_LOG_EVENTS.some((e) => {
      return lines.slice(lastLineIndex).join("").includes(e);
    })
  }

  private static async shouldCheckHost(activationAtts: number) {
    return activationAtts < Hosting.ACTIVATION_LIMIT && !(await Hosting.isUserConnected())
  }

  static async enableKeepAlive() {
    const err = (await Hosting.activateServer()).err;
    if (err) {
      throwErr(err);
    }

    log("Start of the hosting...", "info")
    Hosting._nodePushInterval = setInterval(Hosting.activateServer, Hosting.ACTIVATE_INTERVAL_MS);
  }

  static disableKeepAlive() {
    clearInterval(Hosting._nodePushInterval)
  }

  static async resetMCLog() {
    if (await exists(Hosting.MC_LOG_FILE)) {
      await tryCatch(() => {
        return rename(
          Hosting.MC_LOG_FILE,
          join(Hosting.MC_LOG_FILE, "..", `before-${SERVER_NAME}-${Date.now()}.log`)
        );
      }, "Error while reseting mc log file"
      )
    }
  }

  static async getHostingStatus() {
    return await tryCatch(async () => {
      const result = await Hosting.getStatus();
      if (result.err) {
        throwErr(result.err);
      }
      Hosting.status = result;
    }, "Error checking server status");
  }

  static async startMonitoring(whenHostExists: () => void, whenHostLeaves: (newIP: ServerStatus["ip"]) => void) {
    Hosting.someonePlaing = true;
    for (
      const loopState = {
        firstLoop: true,
        activationAtts: 0,
        lastLineIndex: 0,
      };
      Hosting.someonePlaing;
    ) {
      if (loopState.firstLoop) {
        whenHostExists();
        loopState.firstLoop = false;
      }
      await setTimeoutPromise(Hosting.ACTIVATE_INTERVAL_MS);

      const mcLog = await tryCatch(() => {
        return readFile(Hosting.MC_LOG_FILE, "utf8");
      });
      if (!mcLog) {
        continue;
      }

      const mcLogLines = mcLog.split("\n");
      if (Hosting.hasRecentActivity(mcLogLines, loopState.lastLineIndex)) {
        loopState.activationAtts = 0;
      }

      loopState.lastLineIndex = mcLogLines.length;

      if (await Hosting.shouldCheckHost(loopState.activationAtts)) {
        loopState.activationAtts++;

        Hosting.status = await Hosting.getStatus();

        if (
          Hosting.status.lastUpdateTime &&
          Date.now() - Hosting.status.lastUpdateTime > HOSTING_STALE_MS
        ) {
          Hosting.someonePlaing = false;
          whenHostLeaves(Zerotier.ip);
        } else if (Hosting.status.ip !== Zerotier.ip) {
          whenHostLeaves(Hosting.status.ip);
        }
      }
    }
  }
}
