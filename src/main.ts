import { log, tryCatch, throwErr } from "./utils";
import UI from "./managers/ui";
import Zerotier from "./managers/zerotier";
import World from "./managers/world";
import JDK from "./managers/jdk";
import Tlauncher from "./managers/tlauncher";
import Process from "./managers/process";
import Hosting from "./managers/hosting";
import App from "./managers/app";
import Setup from "./managers/setup";

tryCatch(
  async () => {
    await Process.init();

    await Setup.ensure();
    await App.checkForUpdates();

    while (true) {
      const option = await UI.menu([
        "Create Server Instance",
        "Choose Server",
        "Add New Server",
      ], "Pseudo-Server", "Choose an option:", "Exit");

      if (option === null) {
        await Process.stop();
      }

      if (option === "Create Server Instance") {
        let serverName = "";
        let somethingElse = "";
        let step = 1;

        while (step > 0 && step < 3) {
          if (step === 1) {
            const result = await UI.input("[1|2]: Server creation...", "Type a name for your server:", serverName || undefined);
            if (result === null) { step = 0; break; }
            serverName = result;
            step = 2;
          }
          if (step === 2) {
            const result = await UI.input("[2|2]: Server creation...", "Type something else:", somethingElse || undefined);
            if (result === null) { step = 1; continue; }
            somethingElse = result;
            step = 3;
          }
        }

        if (step < 2) continue; // Esc on step 1 → main menu
        break; // both steps done → proceed to setup
      }

      if (option === "Choose Server") continue;
      if (option === "Add New Server") continue;
    }

    JDK.getRam();

    await Tlauncher.checkAccountType();

    await Zerotier.start();
    await Zerotier.joinNetwork();
    Zerotier.getIP();

    await Tlauncher.initCustomVersion();

    await Tlauncher.initSettings();
    await Tlauncher.chooseCustomVersion();

    Tlauncher.launch();

    await Hosting.startMonitoring();

    await World.init();

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

        World.enableRepeatedPush();
      }
    });
  },
  async (err) => {
    log(err, "error");
    await Process.stop();
  }
);
