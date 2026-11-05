import { hashPassword } from "better-auth/crypto";
import { createInterface } from "node:readline/promises";

async function promptLine(prompt) {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await terminal.question(prompt);
  } finally {
    terminal.close();
  }
}

function promptHidden(prompt) {
  const { stdin, stdout } = process;
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    throw new Error("Run this script in an interactive terminal so the password can be entered without echo.");
  }

  return new Promise((resolve, reject) => {
    let password = "";
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();

    function finish(error) {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
      if (error) reject(error);
      else resolve(password);
    }

    function onData(key) {
      if (key[0] === 3) {
        finish(new Error("Password entry cancelled."));
      } else if (key[0] === 13 || key[0] === 10) {
        finish();
      } else if (key[0] === 127 || key[0] === 8) {
        password = password.slice(0, -1);
      } else {
        password += key.toString();
      }
    }

    stdin.on("data", onData);
  });
}

try {
  const currentEmail = (await promptLine("Current owner email: ")).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(currentEmail) || currentEmail.length > 254) {
    throw new Error("Enter a valid current owner email address.");
  }

  const newEmail = (await promptLine("New owner email: ")).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail) || newEmail.length > 254) {
    throw new Error("Enter a valid owner email address.");
  }

  const password = await promptHidden("New owner password (12+ characters): ");
  if (password.length < 12 || password.length > 128) {
    throw new Error("Password must be between 12 and 128 characters.");
  }

  const passwordHash = (await hashPassword(password)).replaceAll("'", "''");
  const escapedCurrentEmail = currentEmail.replaceAll("'", "''");
  const escapedEmail = newEmail.replaceAll("'", "''");
  console.log(`-- Import this SQL in phpMyAdmin after selecting u905864148_bigjoe_db.
-- Confirm the current and new owner emails before executing.
UPDATE \`User\` AS u
JOIN \`Account\` AS a ON a.\`userId\` = u.\`id\`
SET u.\`email\` = '${escapedEmail}',
    a.\`password\` = '${passwordHash}'
WHERE u.\`email\` = '${escapedCurrentEmail}'
  AND u.\`role\` = 'OWNER'
  AND u.\`isActive\` = 1
  AND a.\`providerId\` = 'credential'
  AND a.\`password\` IS NOT NULL;

SELECT ROW_COUNT() AS updated_rows;

SELECT u.\`email\`, u.\`role\`, u.\`isActive\`,
       COUNT(a.\`id\`) AS credential_accounts,
       SUM(a.\`password\` IS NOT NULL) AS password_credentials
FROM \`User\` AS u
LEFT JOIN \`Account\` AS a
  ON a.\`userId\` = u.\`id\`
 AND a.\`providerId\` = 'credential'
WHERE u.\`email\` = '${escapedEmail}'
  AND u.\`role\` = 'OWNER'
GROUP BY u.\`id\`, u.\`email\`, u.\`role\`, u.\`isActive\`;`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Could not generate the password reset SQL.");
  process.exitCode = 1;
}
