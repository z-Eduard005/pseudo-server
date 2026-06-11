import dgram from "dgram";
import { BROADCAST_ZT_IP, MC_PORT } from "../constants";
import { log, tryCatch } from "../utils";
import Zerotier from "./zerotier";
import Minecraft from "./minecraft";

const BROADCAST_PORT = 42069;

export default class Hosting {
  static status: { ip: string | null } = { ip: null };

  private static readonly DISCOVER_MS = 5_000;
  private static readonly BEAT_MS = 3_000;
  private static readonly TIMEOUT_MS = 30_000;

  private static socket: dgram.Socket | null = null;
  private static beatTimer: NodeJS.Timeout | null = null;
  private static discTimer: NodeJS.Timeout | null = null;
  private static liveTimer: NodeJS.Timeout | null = null;
  private static lastBeat = 0;
  private static found = false;

  static start() {
    Minecraft.addServerToMenu(Hosting.status.ip ? Hosting.status.ip : Zerotier.ip!);

    Hosting.found = false;

    const sock = dgram.createSocket("udp4");
    sock.on("message", (data) => {
      tryCatch(() => {
        const msg = JSON.parse(data.toString()) as { type: string; ip: string };
        if (msg.ip === Zerotier.ip) return;
        Hosting.onBeat(msg.ip);
      }, undefined, true);
    });
    tryCatch(() => sock.bind(BROADCAST_PORT), `Can't bind UDP ${BROADCAST_PORT}`);
    Hosting.socket = sock;

    Hosting.send({ type: "PING", ip: Zerotier.ip! });

    Hosting.discTimer = setTimeout(() => {
      if (!Hosting.found) Hosting.claim();
    }, Hosting.DISCOVER_MS);

    Hosting.liveTimer = setInterval(() => {
      if (
        Hosting.found &&
        Hosting.status.ip !== Zerotier.ip &&
        Date.now() - Hosting.lastBeat > Hosting.TIMEOUT_MS
      ) {
        Hosting.claim();
      }
    }, 10_000);
  }

  static enableKeepAlive() {
    if (Hosting.beatTimer) return;
    Hosting.beatTimer = setInterval(() => {
      Hosting.send({ type: "HEARTBEAT", ip: Zerotier.ip! });
    }, Hosting.BEAT_MS);
  }

  static disableKeepAlive() {
    if (Hosting.beatTimer) { clearInterval(Hosting.beatTimer); Hosting.beatTimer = null; }
  }

  static stop() {
    Hosting.disableKeepAlive();
    if (Hosting.discTimer) { clearTimeout(Hosting.discTimer); Hosting.discTimer = null; }
    if (Hosting.liveTimer) { clearInterval(Hosting.liveTimer); Hosting.liveTimer = null; }
    Hosting.socket?.close();
    Hosting.socket = null;
  }

  private static onBeat(ip: string) {
    Hosting.lastBeat = Date.now();

    if (!Hosting.found) {
      Hosting.found = true;
      if (Hosting.discTimer) { clearTimeout(Hosting.discTimer); Hosting.discTimer = null; }
      Hosting.status.ip = ip;
      log(`Someone is already playing, the server is running on IP - ${ip}:${MC_PORT}\nJust connect :)`, "success");
      return;
    }

    if (Hosting.status.ip === ip) return;

    if (Hosting.status.ip === Zerotier.ip) {
      if (ip < Zerotier.ip!) {
        Hosting.status.ip = ip;
        Hosting.disableKeepAlive();
        Hosting.notifyChange(ip);
      }
    } else {
      Hosting.status.ip = ip;
      Hosting.notifyChange(ip);
    }
  }

  private static claim() {
    Hosting.status.ip = Zerotier.ip!;
    Hosting.found = true;
    Hosting.enableKeepAlive();
    Hosting.send({ type: "HEARTBEAT", ip: Zerotier.ip! });
    Hosting.notifyChange(Zerotier.ip!);
  }

  private static notifyChange(ip: string) {
    log(
      ip === Zerotier.ip
        ? "Wait, now you will be the host..."
        : `Reconecting to new host on IP - ${ip}:${MC_PORT}...`,
      "warning",
    );
    Minecraft.addServerToMenu(Hosting.status.ip ? Hosting.status.ip : Zerotier.ip!);
  }

  private static send(msg: object) {
    const data = Buffer.from(JSON.stringify(msg));
    tryCatch(() => {
      Hosting.socket?.send(data, BROADCAST_PORT, BROADCAST_ZT_IP);
    }, undefined, true);
  }
}
