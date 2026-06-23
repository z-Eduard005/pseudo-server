import { log, tryCatch, throwErr, color } from "./utils";
import UI, { type ListItem } from "./managers/ui";
import Zerotier from "./managers/zerotier";
import Git from "./managers/git";
import Java from "./managers/java";
import Tlauncher from "./managers/tlauncher";
import Process from "./managers/process";
import Hosting from "./managers/hosting";
import App, { type Instance } from "./managers/app";
import { CONFIG_FILE } from "./constants";
import { basename } from "path";

tryCatch(
  async () => {
    await Process.init();
    await App.setup();

    let mainOptionIndex = 0;
    const settingsAction = async () => {
      while (true) {
        const { value, cancelled } = await UI.list(
          [
            { label: "Zerotier Network ID", badge: "locked", blocked: true },
            { label: "test", badge: "locked", blocked: true }
          ],
          {
            title: "Settings",
            desc: "Change these on your own risk",
            lockable: true,
            action: { label: "□ Unlock", run: () => { } }
          }
        );
        if (cancelled) return;

        if (value === "Zerotier Network ID") {
          const config = await App.getConfig(CONFIG_FILE);
          const { value: newId, cancelled: inputCancelled } = await UI.input({
            title: "ZeroTier Network ID",
            desc: `Your personal Network ID\nYou can get it from - ${Zerotier.ADMIN_URL}`,
            defaultValue: (config["zerotierID"] as string) ?? "",
            filter: /[a-z0-9]/
          });

          if (inputCancelled) continue;
          await App.putConfig(CONFIG_FILE, { zerotierID: newId });
        }
      }
    };

    while (true) {
      const { value, cancelled, index } = await UI.list([
        "> Create Server Instance",
        "= Choose Server",
        "+ Add New Server (Connect)",
      ], {
        title: UI.START_ART,
        desc: "Choose an option:",
        backText: "Exit",
        defaultValue: mainOptionIndex,
        action: { label: "⛭ Settings", run: settingsAction },
        footerText: "'Ctrl + Scroll' to zoom"
      });
      mainOptionIndex = index;

      if (cancelled) await Process.stop();

      if (value === "> Create Server Instance") {
        let lastTlauncherLaunch = 0;
        let serverName = "";
        let serverVersion = "";
        let serverVersionIndex = -1;
        let step = 1;
        let existing: Instance[] = [];

        while (step > 0 && step < 3) {
          if (step === 1) {
            const config = await App.getConfig(CONFIG_FILE);
            existing = (config["instances"] as Instance[]) ?? [];

            const { value, cancelled } = await UI.input({
              title: `${color("[1/3]:", "info")} Server creation...`,
              filter: /[a-zA-Z_-]/,
              desc: "Type a name for your server instance:",
              defaultValue: serverName,
              validate: (name) => {
                if (name.length > 20) return "Server name too long (max 20)";
                return existing.some(i => i.name === name) ? "This server name already exists" : null;
              }
            });

            if (cancelled) { step = 0; break; }
            serverName = value;

            step = 2;
          }
          if (step === 2) {
            const getAvailableVersions = async () => {
              return (await Tlauncher.installedVersions(existing.map(i => i.name))).map(Java.toVersionOption)
            }
            const versionItems = await getAvailableVersions();

            const { value, cancelled, index } = await UI.list(versionItems, {
              title: `${color("[2/3]:", "info")} Server creation...`,
              desc: "Choose Minecraft version (install from tlauncher):\n\nNot Supported:\n- regular versions\n- fabric below 1.14\n- forge above 1.13.2",
              refresh: () => getAvailableVersions(),
              action: {
                label: "> Open TLauncher", run: () => {
                  if (Date.now() - lastTlauncherLaunch < 5000) return;
                  lastTlauncherLaunch = Date.now();
                  return Tlauncher.open();
                }
              },
              defaultValue: serverVersionIndex
            });

            if (cancelled) { serverVersionIndex = index; step = 1; continue; }
            serverVersion = value;
            serverVersionIndex = index;
            await App.initInstance(serverName, serverVersion);

            await Java.downloadServerJar(serverVersion, serverName);
            await Java.installServer(serverName);
            const config = await App.getConfig(CONFIG_FILE);
            const instances = (config["instances"] as Instance[]) ?? [];
            const inst = instances.find(i => i.name === serverName);
            if (inst) inst.ready = "server-installed";
            await App.putConfig(CONFIG_FILE, { instances });

            step = 3;
          }
        }

        if (step < 2) continue;
        break;
      }

      if (value === "= Choose Server") {
        const config = await App.getConfig(CONFIG_FILE);
        const instances = ((config["instances"] as Instance[]) ?? []).filter(i => i.name !== basename(App.PENDING_DIR));
        if (instances.length === 0) continue;

        const { value, cancelled } = await UI.list(
          instances.map(i => {
            const item: ListItem = { label: i.name };
            if (i.ready !== "done") {
              item.badge = "Not Ready";
            } else if (i.owner === "me") {
              item.badge = "★";
              item.badgeColor = "green";
            } else {
              item.badge = `☆ ${i.owner}`;
              item.badgeColor = "yellow";
            }
            return item;
          }),
          { title: "Choose Server", desc: "Select an instance to play on:" }
        );
        console.log(value);

        if (cancelled) continue;
        continue;
      }
      if (value === "+ Add New Server (Connect)") continue;
    }
    UI.restoreMainScreen();

    Java.getRam();

    await Tlauncher.checkAccountType();

    await Zerotier.start();
    await Zerotier.join("TEST");
    Zerotier.getIP();

    await Tlauncher.chooseVersion("TEST");
    await Tlauncher.open();

    await Hosting.startMonitoring();

    await Git.worldInit();

    await Java.generateServerSettings(Zerotier.ip!, "TEST");
    await Java.start("TEST");

    Java.process?.on("error", async (err) => {
      throwErr(`Error starting Java server. Check path to Java: ${Java.getJavaPath("TEST")}\n${err}`);
    });
    Java.process?.on("close", async (code) => {
      if (code !== 0) {
        throwErr(`Server terminated with an error (code: ${code})`);
      }
      await Process.stop("Server successfully stopped");
    });
    Java.process?.stdout.on("data", async (data) => {
      process.stdout.write(data);

      const ADMIN_NAME = "TEST";

      if (data.includes(`${ADMIN_NAME} joined the game`)) {
        Java.runMCCommand(`op ${ADMIN_NAME}`);
      }

      if (data.includes("Unloading dimension 1")) {
        log(`You have started the server on port: ${Zerotier.ip}:${Java.PORT}\nHave fun playing :)`, "success");

        Git.worldEnableRepeatedPush();
      }
    });
  },
  async (err) => {
    UI.restoreMainScreen();
    log(err, "error");
    await Process.stop();
  }
);
