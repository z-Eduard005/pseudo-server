import { createSocket, type Socket } from "dgram";
import { MC_PORT } from "../constants";
import { log } from "../utils";
import Zerotier from "./zerotier";

type BroadcastData = { type: string; ip: string }

export default class Hosting {
  private static readonly BROADCAST_PORT = 42069;
  private static readonly BROADCAST_IP = `${Zerotier.START_IP}.255.255`;
  static ip: string | null = null;

  private static socket: Socket;
  private static heartBeatTimer: NodeJS.Timeout | undefined;

  static startMonitoring(): Promise<void> {
    return new Promise((resolve) => {
      let hostFound = false;
      let staleTimer: NodeJS.Timeout | undefined;

      const becomeHost = () => {
        if (Hosting.ip === Zerotier.ip) return;

        Hosting.ip = Zerotier.ip;

        clearInterval(Hosting.heartBeatTimer);
        Hosting.heartBeatTimer = setInterval(() => {
          const data = Buffer.from(JSON.stringify({ type: "HEARTBEAT", ip: Zerotier.ip }));
          Hosting.socket.send(data, Hosting.BROADCAST_PORT, Hosting.BROADCAST_IP);
        }, 3_000);

        log("Wait, now you will be the host...", "warning");
        resolve();
      };

      const resetStale = () => {
        clearTimeout(staleTimer);
        staleTimer = setTimeout(becomeHost, 20_000);
      };

      Hosting.socket = createSocket("udp4");
      Hosting.socket.on("message", (data) => {
        const msg = JSON.parse(data.toString()) as BroadcastData;
        if (msg.ip === Zerotier.ip) return;

        if (!hostFound) {
          hostFound = true;
          Hosting.ip = msg.ip;
          log(`Someone is already playing, server on ${msg.ip}:${MC_PORT}`, "success");
          resetStale();
        } else if (Hosting.ip === msg.ip) {
          resetStale();
        }
      });
      Hosting.socket.bind(Hosting.BROADCAST_PORT);

      setTimeout(() => {
        if (hostFound) return;
        becomeHost();
      }, 5_000);
    });
  }

  static disableKeepAlive() {
    clearInterval(Hosting.heartBeatTimer);
  }
}
