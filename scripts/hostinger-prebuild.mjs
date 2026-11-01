import { execSync } from "node:child_process";

if (process.env.HOSTINGER_BUILD === "1") {
  execSync("npm run db:deploy && npm run db:seed", { stdio: "inherit" });
}
