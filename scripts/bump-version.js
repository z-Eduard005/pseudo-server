const fs = require("fs");

const file = "src/managers/app.ts";
let content = fs.readFileSync(file, "utf8");
const match = content.match(
  /private static readonly VERSION = "(\d+\.\d+\.)(\d+)"/,
);

if (match) {
  const newPatch = Number(match[2]) + 1;
  const newVersion = match[1] + newPatch;
  content = content.replace(
    /private static readonly VERSION = "\d+\.\d+\.\d+"/,
    `private static readonly VERSION = "${newVersion}"`,
  );
  fs.writeFileSync(file, content);
  console.log(`Bumped to ${newVersion}`);
} else {
  console.error("Failed to bump version: VERSION pattern not found.");
}
