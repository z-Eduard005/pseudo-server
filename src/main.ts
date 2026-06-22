import { log, tryCatch, throwErr, color } from "./utils";
import UI, { type ListItem } from "./managers/ui";
import Zerotier from "./managers/zerotier";
import Git from "./managers/git";
import JDK from "./managers/jdk";
import Tlauncher from "./managers/tlauncher";
import Process from "./managers/process";
import Hosting from "./managers/hosting";
import App, { type Instance } from "./managers/app";
import { CONFIG_FILE } from "./constants";

tryCatch(
  async () => {
    await Process.init();
    await App.setup();

    let mainOptionIndex = 0;
    const settingsAction = async () => {
      while (true) {
        const { value, cancelled } = await UI.list(
          [{ label: "Zerotier Network ID", badge: "locked" }, { label: "test", badge: "locked" }],
          {
            title: "Settings",
            desc: "Change theese on your own risk",
            lockable: true,
            action: { label: "⚷ Unlock", run: () => { } }
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
        "✏ Create Server Instance",
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

      if (value === "✏ Create Server Instance") {
        let lastTlauncherLaunch = 0;
        let serverName = "";
        let serverVersion = "";
        let serverVersionIndex = -1;
        let step = 1;

        while (step > 0 && step < 3) {
          if (step === 1) {
            const config = await App.getConfig(CONFIG_FILE);
            const existing = (config["instances"] as Instance[]) ?? [];

            const { value, cancelled } = await UI.input({
              title: `${color("[1|3]:", "info")} Server creation...`,
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
            const versions = await Tlauncher.installedVersions();
            const { value, cancelled, index } = await UI.list(versions, {
              title: `${color("[2|3]:", "info")} Server creation...`,
              desc: "Choose Minecraft version (install from tlauncher):",
              refresh: Tlauncher.installedVersions,
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

            step = 3;
          }
        }

        if (step < 2) continue;
        break;
      }

      if (value === "= Choose Server") {
        const config = await App.getConfig(CONFIG_FILE);
        const instances = (config["instances"] as Instance[]) ?? [];
        if (instances.length === 0) continue;

        const { value, cancelled } = await UI.list(
          instances.map(i => {
            const item: ListItem = { label: i.name };
            if (!i.ready) {
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

    JDK.getRam();

    await Tlauncher.checkAccountType();

    await Zerotier.start();
    await Zerotier.join("TEST");
    Zerotier.getIP();

    await Tlauncher.chooseVersion("TEST");
    await Tlauncher.open();

    await Hosting.startMonitoring();

    await Git.worldInit();

    await JDK.generateServerSettings(Zerotier.ip!);
    await JDK.start();

    JDK.process?.on("error", async (err) => {
      throwErr(`Error starting Java server. Check path to Java, it should be like this: ${JDK.FILE}\n${err}`);
    });
    JDK.process?.on("close", async (code) => {
      if (code !== 0) {
        throwErr(`Server terminated with an error (code: ${code})`);
      }
      await Process.stop("Server successfully stopped");
    });
    JDK.process?.stdout.on("data", async (data) => {
      process.stdout.write(data);

      const ADMIN_NAME = "TEST";

      if (data.includes(`${ADMIN_NAME} joined the game`)) {
        JDK.runMCCommand(`op ${ADMIN_NAME}`);
      }

      if (data.includes("Unloading dimension 1")) {
        log(`You have started the server on port: ${Zerotier.ip}:${JDK.PORT}\nHave fun playing :)`, "success");

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
