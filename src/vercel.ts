import express, { json } from "express";
import type { Request as Req, RequestHandler } from "express";
import { Redis } from "@upstash/redis";

type ServerStatusData = {
  ipv4: string;
  lastUpdateTime: number;
};
type CustomReq = Omit<Req, "body"> & { body: { ipv4: string } };

const kv = Redis.fromEnv();
const KV_KEY = "server-status";
const PORT = 3001;
const API_PASS = "TEST";
const STALE_MS = 35 * 1000;

async function getServerStatusDB(): Promise<ServerStatusData | null> {
  try {
    return await kv.get<ServerStatusData>(KV_KEY);
  } catch {
    return null;
  }
}

async function updateServerStatusDB(
  ipv4: ServerStatusData["ipv4"],
  lastUpdateTime: ServerStatusData["lastUpdateTime"],
): Promise<void> {
  await kv.set(KV_KEY, { ipv4, lastUpdateTime } as ServerStatusData);
}


const app = express();
app.use(json());

const checkPass: RequestHandler = (req: CustomReq, res, next) => {
  if (req.headers["x-api-password"] === API_PASS) {
    next();
  } else {
    res.status(403).json({ err: "Access denied!" });
  }
};

app.post("/activate", checkPass, async (req: CustomReq, res) => {
  try {
    const { ipv4 } = req.body;
    const current = await getServerStatusDB();
    const now = Date.now();

    if (current?.ipv4 && current?.ipv4 !== ipv4 && current?.lastUpdateTime && now - current.lastUpdateTime < STALE_MS) {
      res.json({ ip: current.ipv4, lastUpdateTime: current.lastUpdateTime, err: "Someone else is already a host" });
      return;
    }

    await updateServerStatusDB(ipv4, now);
    res.json({ ip: ipv4, lastUpdateTime: now, err: null });
  } catch (err) {
    res.status(500).json({ ip: null, lastUpdateTime: null, err: `Error updating server status: ${err}` });
  }
});

app.get("/get", checkPass, async (_req: CustomReq, res) => {
  try {
    const current = await getServerStatusDB();
    if (current) {
      res.json({ ip: current.ipv4, lastUpdateTime: current.lastUpdateTime, err: null });
    } else {
      res.json({ ip: null, lastUpdateTime: null, err: null });
    }
  } catch (err) {
    res.status(500).json({ ip: null, lastUpdateTime: null, err: `Error checking server status: ${err}` });
  }
});

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
