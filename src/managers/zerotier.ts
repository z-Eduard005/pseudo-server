import { spawn } from "child_process";
import { IS_WIN32, USER_NAME } from "../constants";
import { exists, retryRun, run, log, sudo, throwErr, tryCatch } from "../utils"
import { setTimeout as setTimeoutPromise } from "timers/promises";
import { join } from "path";
import { networkInterfaces, tmpdir } from "os";

const ZT_NETWORK_ID = "TEST"

export default class Zerotier {
  private static readonly FILE = IS_WIN32
    ? join("C:", "Program Files (x86)", "ZeroTier", "One", "zerotier-cli.bat")
    : join("/usr", "bin", "zerotier-cli");

  private static readonly INSTALLER_URL = IS_WIN32
    ? "https://download.zerotier.com/dist/ZeroTier%20One.msi"
    : "https://install.zerotier.com";

  private static readonly SUDOERS_FILE = join("/etc", "sudoers.d", "zerotier");
  private static readonly SUDOERS_CONTENT = `${USER_NAME} ALL=(ALL) NOPASSWD: ${Zerotier.FILE} *`;
  private static readonly CMD_TIMEOUT = 4000;

  static readonly START_IP = "10.242";
  private static _ip: string | null = null

  static get ip() {
    return this._ip;
  }

  private static async setupSudoers() {
    log("Setting up sudo privileges for Zerotier...", "info")
    await tryCatch(() => {
      return retryRun(() => {
        return run([
          sudo(`sh -c 'echo "${Zerotier.SUDOERS_CONTENT}" > "${Zerotier.SUDOERS_FILE}"'`),
          sudo(`chmod 440 "${Zerotier.SUDOERS_FILE}"`)
        ]);
      }
      );
    }, "Error setting up sudo privileges for Zerotier");
  }

  static async start() {
    log("Starting zerotier service...", "info");
    await tryCatch(async () => {
      const info = await run(sudo(`"${Zerotier.FILE}" info`));
      if (info.includes("OFFLINE")) {
        spawn(Zerotier.FILE, {
          detached: true,
          shell: true,
        }).unref();
        await setTimeoutPromise(Zerotier.CMD_TIMEOUT);
      }
    }, "Failed to start zerotier")
  }

  static async joinNetwork() {
    log("Joining zerotier network...", "info");
    const networks = await tryCatch(async () => {
      await run(
        sudo(`"${Zerotier.FILE}" join ${ZT_NETWORK_ID}`),
        { inherit: true }
      );
      await setTimeoutPromise(Zerotier.CMD_TIMEOUT);

      return await run(sudo(`"${Zerotier.FILE}" listnetworks`));
    }, "Failed to join zerotier network (try again!)");

    if (
      networks.includes("ACCESS_DENIED") ||
      networks.includes("REQUESTING_CONFIGURATION") ||
      !networks.includes("PRIVATE")
    )
      throwErr("Zerotier authorization failed (contact with admin of the server!)");
  }

  static async leaveNetwork() {
    await tryCatch(() => {
      return run(
        sudo(`"${Zerotier.FILE}" leave ${ZT_NETWORK_ID}`),
        { inherit: true }
      );
    }, "Failed to leave zerotier network", true)
  }

  static getIP() {
    Zerotier._ip =
      Object.values(networkInterfaces())
        .flat()
        .find(
          (interf) => {
            return interf?.family === "IPv4" &&
              !interf.internal &&
              interf.address.startsWith(Zerotier.START_IP);
          }
        )?.address ?? "";
    if (!Zerotier._ip)
      throwErr(
        "Zerotier ipV4 address of this device not found (try to restart the pc)"
      );
  }

  static async install() {
    await tryCatch(async () => {
      if (await exists(Zerotier.FILE)) {
        return;
      }

      log("Installing zerotier...", "info");
      if (IS_WIN32) {
        const ztInstaller = join(tmpdir(), `zt-${Date.now()}.msi`);
        await retryRun(() => {
          return run(
            [
              `curl.exe -fsSL -o "${ztInstaller}" "${Zerotier.INSTALLER_URL}"`,
              `msiexec /i ${ztInstaller} /qn`,
            ],
            { inherit: true }
          );
        });
      } else {
        await run(`sh -c "$(curl -fsSL ${Zerotier.INSTALLER_URL})"`, {
          inherit: true,
        });
        await tryCatch(
          () => {
            return run(
              [
                sudo("systemctl start zerotier-one"),
                sudo("firewall-cmd --add-port=9993/udp --permanent"),
                sudo("firewall-cmd --reload"),
                sudo("systemctl restart zerotier-one"),
              ], { inherit: true }
            );
          },
          "Some zerotier settings not set",
          true
        );
        await Zerotier.setupSudoers();
      }
    }, "Zerotier is not installed");
  }
}
