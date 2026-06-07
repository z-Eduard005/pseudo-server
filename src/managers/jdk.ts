import { spawn } from "child_process";
import type { ChildProcessByStdio } from "child_process";
import { Stream } from "stream";
import { exists, retryRun, run, log, sudo, throwErr, tryCatch } from "../utils";
import { join } from "path";
import { IS_WIN32, MC_PORT, SERVER_DIR, SERVER_NAME } from "../constants";
import { writeFile } from "fs/promises";
import { totalmem } from "os";

export default class JDK {
  private static readonly FORGE_FILE = join(SERVER_DIR, "forge-1.12.2-14.23.5.2860.jar");
  private static readonly PATH = join("/opt", "jdk8u292-b10")
  private static readonly DOWNLOAD_URL =
    "https://github.com/AdoptOpenJDK/openjdk8-binaries/releases/download/jdk8u292-b10/OpenJDK8U-jdk_x64_linux_hotspot_8u292b10.tar.gz";
  private static readonly DOWNLOAD_FILENAME = "jdk8u292-b10.tar.gz";
  private static readonly SERVER_PROPS_FILE = join(SERVER_DIR, "server.properties");
  private static readonly _FILE = IS_WIN32
    ? join("C:", "Program Files", "AdoptOpenJDK", "jdk-8.0.292.10-hotspot", "bin", "java.exe")
    : join(JDK.PATH, "bin", "java");

  private static readonly MIN_RAM_MB = 2700;
  private static readonly MAX_RAM_MB = 7168;
  private static readonly MAX_RAM_PERCENTAGE = 0.4;
  private static _ram = JDK.MIN_RAM_MB;
  private static _process: ChildProcessByStdio<Stream.Writable, Stream.Readable, null> | null = null;

  static get FILE() {
    return this._FILE;
  }

  static get process() {
    return this._process;
  }

  static get ram() {
    return this._ram;
  }

  static async start() {
    log("Server is loading...", "info");
    JDK._process = await tryCatch(() => {
      return spawn(
        JDK._FILE,
        [
          `-Xmx${JDK.ram}M`,
          `-Xms${JDK.ram}M`,
          "-jar",
          JDK.FORGE_FILE,
          "nogui",
        ],
        {
          stdio: ["pipe", "pipe", "inherit"],
          cwd: SERVER_DIR,
          windowsHide: true,
        }
      );
    }, "Error while starting java server")
    JDK._process.stdout.setEncoding("utf8");
  }

  static runMCCommand(cmd: string) {
    if (JDK._process?.stdin.writable) {
      JDK._process.stdin.write(cmd + "\n");
    }
  }

  static async linuxInstall() {
    if (await exists(JDK.PATH)) {
      return;
    }
    log("Installing necessary Java...", "info");

    await tryCatch(async () => {
      await run(sudo(`mkdir -p ${JDK.PATH}`), { inherit: true });
      await retryRun(() => {
        return run(
          [
            sudo(`curl -fsSL -o ${JDK.DOWNLOAD_FILENAME} ${JDK.DOWNLOAD_URL}`),
            sudo(`tar -xzf ${JDK.DOWNLOAD_FILENAME} --strip-components=1`),
            sudo(`rm ${JDK.DOWNLOAD_FILENAME}`),
          ],
          { inherit: true, cwd: JDK.PATH }
        );
      });
    }, "Required java is not installed");
  }

  static async generateServerSettings(ip: string) {
    log("Generating server settings...", "info");
    await tryCatch(
      () => {
        return writeFile(
          JDK.SERVER_PROPS_FILE,
          JDK.SERVER_PROPS.replace("server-ip=", "server-ip=" + ip),
          "utf8"
        );
      },
      "Error creating server configuration files"
    );
  }

  static getRam() {
    const partOfRam = Math.floor((totalmem() / 1024 / 1024) * JDK.MAX_RAM_PERCENTAGE);

    JDK._ram = partOfRam > JDK.MAX_RAM_MB ? JDK.MAX_RAM_MB : partOfRam;
    if (JDK._ram < JDK.MIN_RAM_MB) {
      throwErr("You don't have enough memory to play on the server :(");
    }
  }

  static async kill() {
    await tryCatch(async () => {
      JDK.process?.kill();
      await new Promise<void>((resolve) => {
        if (JDK.process) {
          JDK.process.on("close", () => {
            return resolve();
          });
          if (JDK.process.killed || JDK.process.exitCode !== null) {
            resolve();
          }
        } else {
          resolve();
        }
      });
    }, "JDK process was not killed", true);
  }

  private static readonly SERVER_PROPS = `
#Minecraft server properties
#Sun Dec 15 21:12:03 EET 2024
spawn-protection=0
max-tick-time=60000
generator-settings=
force-gamemode=false
allow-nether=true
gamemode=0
broadcast-console-to-ops=true
enable-query=false
player-idle-timeout=0
difficulty=2
spawn-monsters=true
op-permission-level=4
pvp=true
snooper-enabled=true
level-type=DEFAULT
hardcore=false
enable-command-block=true
max-players=10
network-compression-threshold=256
resource-pack-sha1=
max-world-size=29999984
server-port=${MC_PORT}
server-ip=
spawn-npcs=true
allow-flight=true
level-name=world
view-distance=10
resource-pack=
spawn-animals=true
white-list=false
generate-structures=true
online-mode=false
max-build-height=256
level-seed=
prevent-proxy-connections=false
motd=${SERVER_NAME}
enable-rcon=false
defaultworldgenerator-port=
`;
}
