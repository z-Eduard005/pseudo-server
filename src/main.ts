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

    const option = await UI.menu([
      "Create Server Instance",
      "Choose Server",
      "Add New Server",
    ], "Pseudo-Server", "Choose an option:", "Exit");

    if (option === "Create Server Instance") {
      const serverName = await UI.input("Enter server name", "Type a name for your server:");
      // await createServerInstance();
    } else if (option === "Choose Server") {
      // await chooseServer();
    } else if (option === "Add New Server") {
      // await addNewServer();
    } else {
      await Process.stop();
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
