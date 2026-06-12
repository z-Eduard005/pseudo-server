import { ADMIN_NAME } from "./constants";
import { log, tryCatch, throwErr } from "./utils";
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

    // checking for updates
    await App.checkForUpdates();

    // checking the amount of memory
    JDK.getRam();

    // checking connection to tlauncher account
    await Tlauncher.checkAccountType();

    // connecting to zerotier network
    await Zerotier.start();
    await Zerotier.joinNetwork();
    Zerotier.getIP();

    // copying the minecraft version to the destination directory
    await Tlauncher.initCustomVersion();

    // initializing tlauncher settings
    await Tlauncher.initSettings();
    await Tlauncher.chooseCustomVersion();

    // launching tlauncher
    Tlauncher.launch();

    // choosing who will be the host
    await Hosting.startMonitoring();

    // initialization of the world
    await World.init();

    // server settings generation
    await JDK.generateServerSettings(Zerotier.ip!);

    // starting the server through JDK
    await JDK.start();

    // server event handling
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

      if (data.includes(`${ADMIN_NAME} joined the game`)) {
        JDK.runMCCommand(`op ${ADMIN_NAME}`);
      }

      if (data.includes("Unloading dimension 1")) {
        log(`You have started the server on port: ${Zerotier.ip}:${JDK.PORT}\nHave fun playing :)`, "success");

        // world synchronization every 30 minutes
        World.enableRepeatedPush();
      }
    });
  },
  async (err) => {
    log(err, "error");
    await Process.stop();
  }
);
