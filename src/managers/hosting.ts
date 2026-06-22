import { createSocket, type Socket } from "dgram";
import { log, throwErr, tryCatch } from "../utils";
import Zerotier from "./zerotier";
import JDK from "./jdk";
import Minecraft from "./minecraft";

type BroadcastData = { type: string; ip: string }

export default class Hosting {
  private static readonly BROADCAST_PORT = 42069;
  private static readonly BROADCASTIP = `${Zerotier.START_IP}.255`;
  private static readonly LISTEN_TIMEOUT = 5_000;
  private static readonly HEARTBEAT_INTERVAL = 3_000;
  private static readonly CONFIRM_TIMEOUT = 1_000;
  private static readonly STALE_TIMEOUT = 20_000;
  private static socket: Socket;
  private static heartBeatTimer: NodeJS.Timeout | undefined;
  private static staleTimer: NodeJS.Timeout | undefined;
  private static confirmTimer: NodeJS.Timeout | undefined;
  private static hostFound = false;
  private static resolve: () => void;
  static ip: string | null = null

  static startMonitoring(): Promise<void> {
    return new Promise(async (resolve) => {
      Hosting.resolve = resolve;
      Hosting.hostFound = false;

      Hosting.socket = createSocket("udp4");
      Hosting.socket.on("error", (err) => {
        throwErr(`Zerotier Socket error (check your connection): ${err.message}`);
      });

      Hosting.socket.on("message", (data) => {
        const msg = JSON.parse(data.toString()) as BroadcastData;
        if (msg.ip === Zerotier.ip) return;

        if (!Hosting.hostFound) {
          Hosting.hostFound = true;
          Hosting.ip = msg.ip;
          const fullIP = `${msg.ip}:${JDK.PORT}`;

          log(`Someone is already playing on ${fullIP}`, "info");
          Minecraft.addServer(fullIP, "TEST");
          Hosting.continueMonitoring();
        } else if (Hosting.ip === msg.ip) {
          Hosting.continueMonitoring();
        } else if (Hosting.ip === Zerotier.ip && msg.ip < Zerotier.ip!) {
          clearInterval(Hosting.heartBeatTimer);
          clearTimeout(Hosting.confirmTimer);
          Hosting.ip = msg.ip;
          const fullIP = `${msg.ip}:${JDK.PORT}`;

          log(`Reconecting to new host on ${fullIP}`, "info");
          Minecraft.addServer(fullIP, "TEST");
          Hosting.continueMonitoring();
        }
      });

      await tryCatch(
        () => Hosting.socket.bind(Hosting.BROADCAST_PORT),
        `Port ${Hosting.BROADCAST_PORT} is already in use by ${Hosting.getPortOwner() || "another process"}`
      );

      setTimeout(() => {
        if (Hosting.hostFound) return;
        Hosting.becomeHost();
      }, Hosting.LISTEN_TIMEOUT);
    });
  }

  private static becomeHost() {
    if (Hosting.ip === Zerotier.ip) return;

    Hosting.ip = Zerotier.ip;

    clearInterval(Hosting.heartBeatTimer);
    Hosting.heartBeatTimer = setInterval(async () => {
      await tryCatch(
        () => Hosting.socket.send(
          Buffer.from(JSON.stringify({ type: "HEARTBEAT", ip: Zerotier.ip })),
          Hosting.BROADCAST_PORT,
          Hosting.BROADCASTIP
        ),
        "Hosting connection error (bad internet)"

      );
    }, Hosting.HEARTBEAT_INTERVAL);

    Hosting.confirmTimer = setTimeout(() => {
      log("Wait, you will be hosting...", "info");
      Minecraft.addServer(`${Zerotier.ip}:${JDK.PORT}`, "TEST");
      Hosting.resolve();
    }, Hosting.CONFIRM_TIMEOUT);
  }

  private static continueMonitoring() {
    clearTimeout(Hosting.staleTimer);
    Hosting.staleTimer = setTimeout(Hosting.becomeHost, Hosting.STALE_TIMEOUT);
  }

  static disableKeepAlive() {
    clearInterval(Hosting.heartBeatTimer);
  }

  private static getPortOwner(): string | null {
    return null;
  }
}
