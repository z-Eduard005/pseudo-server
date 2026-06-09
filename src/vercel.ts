import express, { json } from "express";
import type { Request as Req, RequestHandler } from "express";
import { Redis } from "@upstash/redis";
import { tryCatch } from "./utils";
import { VERCEL_PORT, VERCEL_API_PASS, HOSTING_STALE_MS } from "./constants";

type ServerStatusData = {
  ipv4: string;
  lastUpdateTime: number;
};
type CustomReq = Omit<Req, "body"> & { body: { ipv4: string } };

const KV_KEY = "server-status";
const kv = Redis.fromEnv();

const getServerStatusDB = async () => {
  return await tryCatch(
    () => kv.get<ServerStatusData>(KV_KEY),
    "Failed to get server status from KV",
  );
};

const updateServerStatusDB = async (
  ipv4: ServerStatusData["ipv4"],
  lastUpdateTime: ServerStatusData["lastUpdateTime"],
) => {
  await tryCatch(
    () => kv.set(KV_KEY, { ipv4, lastUpdateTime } as ServerStatusData),
    "Failed to update server status in KV",
  );
};


const app = express();
app.use(json());

const checkPass: RequestHandler = (req: CustomReq, res, next) => {
  if (req.headers["x-api-password"] === VERCEL_API_PASS) {
    next();
  } else {
    res.status(403).json({ err: "Access denied!" });
  }
};

app.post("/activate", checkPass, async (req: CustomReq, res) => {
  await tryCatch(
    async () => {
      const { ipv4 } = req.body;
      const current = await getServerStatusDB();
      const now = Date.now();

      if (current?.ipv4 && current?.ipv4 !== ipv4 && current?.lastUpdateTime && now - current.lastUpdateTime < HOSTING_STALE_MS) {
        res.json({ ip: current.ipv4, lastUpdateTime: current.lastUpdateTime, err: "Someone else is already a host" });
        return;
      }

      await updateServerStatusDB(ipv4, now);
      res.json({ ip: ipv4, lastUpdateTime: now, err: null });
    },
    (err) => {
      res.status(500).json({ ip: null, lastUpdateTime: null, err: `Error updating server status: ${err}` });
    },
  );
});

app.get("/get", checkPass, async (_req: CustomReq, res) => {
  await tryCatch(
    async () => {
      const current = await getServerStatusDB();
      if (current) {
        res.json({ ip: current.ipv4, lastUpdateTime: current.lastUpdateTime, err: null });
      } else {
        res.json({ ip: null, lastUpdateTime: null, err: null });
      }
    },
    (err) => {
      res.status(500).json({ ip: null, lastUpdateTime: null, err: `Error checking server status: ${err}` });
    },
  );
});

app.listen(VERCEL_PORT, () => {
  console.log(`Server started on port ${VERCEL_PORT}`);
});
