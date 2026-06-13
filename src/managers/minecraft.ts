import { join } from "path";
import { tryCatch } from "../utils";
import { rm, writeFile } from "fs/promises";

const CUSTOM_VERSION_DIR = "TEST";
const SERVER_NAME = "TEST";
export default class Minecraft {
  private static readonly SERVERS_BAK_FILE = join(CUSTOM_VERSION_DIR, "servers.dat.bak");
  private static readonly SERVERS_FILE = join(CUSTOM_VERSION_DIR, "servers.dat");

  private static serverToNBT(ip: string) {
    const startNBTFile =
      "\\00\\00\\09\\00\\07\\73\\65\\72\\76\\65\\72\\73\\0A\\00\\00\\";
    const serversLen = "00\\01";
    const ipHexField = "\\08\\00\\02\\69\\70\\";
    const nameHexField = "\\08\\00\\04\\6E\\61\\6D\\65\\";
    const endNBTFile = "\\00\\00";

    const toByteStr = (num: number) => {
      return num.toString(16).padStart(2, "0");
    };
    const toHexWithLen = (str: string) => {
      return `00\\${toByteStr(str.length)}\\${str
        .split("")
        .map((c) => {
          return toByteStr(c.charCodeAt(0));
        })
        .join("\\")}`;
    };

    const hexParts = [
      startNBTFile,
      serversLen,
      ipHexField,
      toHexWithLen(ip),
      nameHexField,
      toHexWithLen(SERVER_NAME),
      endNBTFile,
    ]
      .join("")
      .split("\\")
      .filter((p) => p);

    const buffer = Buffer.alloc(hexParts.length);
    hexParts.forEach((part, i) => {
      return part && (buffer[i] = parseInt(part, 16));
    });

    return "\n" + buffer;
  };

  static addServerToMenu(ip: string) {
    tryCatch(
      async () => {
        await rm(Minecraft.SERVERS_BAK_FILE, { force: true });
        await writeFile(
          Minecraft.SERVERS_FILE,
          Minecraft.serverToNBT(ip),
          "utf8"
        );
      },
      `The server was not added to the Minecraft menu automatically (incorrect path: ${Minecraft.SERVERS_FILE})`,
      true
    );
  }
}
