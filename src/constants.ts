import { join } from "path";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";

export const IS_WIN32 = process.platform === "win32";
export const LINUX_SHELL = "/bin/bash";

export const USER_NAME = process.env["USER"] || process.env["USERNAME"]!;
export const USER_DIR = homedir();

export const DESKTOP_ENTRY_PATH = join(
  USER_DIR,
  ".local",
  "share",
  "applications"
);

export const MC_REL_PATH = join(
  "AppData",
  "Roaming",
  ".tlauncher",
  "legacy",
  "Minecraft"
);

export const PFX_FLAG_FILE = join(
  USER_DIR,
  "Programs",
  "proton-legacylauncher",
  ".pfx-created"
);

export const MC_DIR = join(
  IS_WIN32
    ? join(USER_DIR, MC_REL_PATH)
    : existsSync(PFX_FLAG_FILE)
      ? join(
        USER_DIR,
        ".steam",
        "steam",
        "steamapps",
        "compatdata",
        readFileSync(PFX_FLAG_FILE, "utf8").trim(),
        "pfx",
        "drive_c",
        "users",
        "steamuser",
        MC_REL_PATH
      )
      : String(null)
);

export const GAME_DIR = join(MC_DIR, "game");
export const DESKTOP_DIR = join(USER_DIR, "Desktop");
export const APP_DIR = IS_WIN32 ? join() : join();
export const APP_NAME = "Pseudo-server";
export const APP_FILE = join(APP_DIR, IS_WIN32 ? APP_NAME + ".exe" : APP_NAME);
export const CONFIG_FILE = join(APP_DIR, "config.json");