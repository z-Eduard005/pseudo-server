import { join } from "path";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";

export const IS_WIN32 = process.platform === "win32";
export const LINUX_SHELL = "/bin/bash";
export const DEFAULT_LINUX_TERM = "ptyxis";
export const DEFAULT_LINUX_OPENER = "xdg-open";

export const SERVER_NAME = "Gregicality-Server";
export const CUSTOM_VERSION = "GTmodpack";
export const SHORTCUT_FILENAME = `${SERVER_NAME}.lnk`;
export const ADMIN_NAME = "z_Eduard005";

export const MC_PORT = "25565";

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
export const CUSTOM_VERSION_DIR = join(GAME_DIR, "home", CUSTOM_VERSION);
export const SERVER_DIR = join(CUSTOM_VERSION_DIR, "server");

export const ICON_FILE = join(
  CUSTOM_VERSION_DIR,
  IS_WIN32 ? "icon.ico" : "icon.png"
);

export const DESKTOP_DIR = join(USER_DIR, "Desktop");
export const SHORTCUT_FILE = join(CUSTOM_VERSION_DIR, SHORTCUT_FILENAME);

export const WINGET_PACKAGES = ["AdoptOpenJDK.OpenJDK.8", "Git.Git"];

export const DEFAULT_START_ZT_IP = "10.242.";

export const CONFIG_FILE = join(CUSTOM_VERSION_DIR, "config.json");
