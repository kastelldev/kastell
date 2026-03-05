import { readFileSync, existsSync, mkdirSync } from "fs";
import { spawnSync } from "child_process";
import { homedir } from "os";
import { join } from "path";
import { sanitizedEnv } from "./ssh.js";

const SSH_KEY_FILES = ["id_ed25519.pub", "id_rsa.pub", "id_ecdsa.pub"];

export function findLocalSshKey(): string | null {
  const sshDir = join(homedir(), ".ssh");
  for (const keyFile of SSH_KEY_FILES) {
    const keyPath = join(sshDir, keyFile);
    if (existsSync(keyPath)) {
      try {
        const content = readFileSync(keyPath, "utf-8").trim();
        if (content.startsWith("ssh-")) {
          return content;
        }
      } catch {
        continue;
      }
    }
  }
  return null;
}

export function generateSshKey(): string | null {
  const sshDir = join(homedir(), ".ssh");
  const keyPath = join(sshDir, "id_ed25519");

  try {
    // Ensure ~/.ssh directory exists
    if (!existsSync(sshDir)) {
      mkdirSync(sshDir, { mode: 0o700, recursive: true });
    }

    // Generate key with no passphrase
    // Use sanitizedEnv so tokens are not inherited by the ssh-keygen subprocess
    spawnSync("ssh-keygen", ["-t", "ed25519", "-f", keyPath, "-N", "", "-C", "kastell"], {
      stdio: "pipe",
      env: sanitizedEnv(),
    });

    const pubKeyPath = `${keyPath}.pub`;
    if (existsSync(pubKeyPath)) {
      return readFileSync(pubKeyPath, "utf-8").trim();
    }
  } catch {
    return null;
  }
  return null;
}

export function getSshKeyName(): string {
  return `kastell-${Date.now()}`;
}
