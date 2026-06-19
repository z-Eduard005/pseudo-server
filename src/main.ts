import { log, tryCatch, throwErr, color } from "./utils";
import UI from "./managers/ui";
import Zerotier from "./managers/zerotier";
import Git from "./managers/git";
import JDK from "./managers/jdk";
import Tlauncher from "./managers/tlauncher";
import Process from "./managers/process";
import Hosting from "./managers/hosting";
import App from "./managers/app";

tryCatch(
  async () => {
    await Process.init();
    await App.setup();

    let mainOptionIndex = 0;
    while (true) {
      const { value, cancelled, index } = await UI.list([
        "Create Server Instance",
        "Choose Server",
        "Add New Server",
      ], { title: UI.START_ART, desc: "Choose an option:", backText: "Exit", defaultValue: mainOptionIndex });
      mainOptionIndex = index;

      if (cancelled) await Process.stop();

      if (value === "Create Server Instance") {
        let serverName = "";
        let serverVersion = "";
        let serverVersionIndex = -1;
        let step = 1;

        while (step > 0 && step < 3) {
          if (step === 1) {
            const { value, cancelled } = await UI.input({
              title: `${color("[1|3]:", "info")} Server creation...`,
              filter: /[a-zA-Z_-]/,
              desc: "Type a name for your server instance:",
              defaultValue: serverName
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
              action: { label: "Open TLauncher", run: () => Tlauncher.launch() },
              defaultValue: serverVersionIndex
            });

            if (cancelled) { serverVersionIndex = index; step = 1; continue; }
            serverVersion = value;
            serverVersionIndex = index;
            console.log(serverVersion);
            step = 3;
          }
        }

        if (step < 2) continue;
        break;
      }

      if (value === "Choose Server") continue;
      if (value === "Add New Server") continue;
    }
    UI.restoreMainScreen();

    JDK.getRam();

    await Tlauncher.checkAccountType();

    await Zerotier.start();
    await Zerotier.joinNetwork();
    Zerotier.getIP();

    await Tlauncher.initSettings();
    await Tlauncher.chooseCustomVersion();
    Tlauncher.launch();

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
