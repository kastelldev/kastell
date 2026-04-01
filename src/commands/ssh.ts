import { resolveServer } from "../utils/serverSelect.js";
import { checkSshAvailable, sshConnect, sshExec } from "../utils/ssh.js";
import { raw } from "../utils/sshCommand.js";
import { logger } from "../utils/logger.js";

export async function sshCommand(query?: string, options?: { command?: string }): Promise<void> {
  if (!checkSshAvailable()) {
    logger.error("SSH client not found. Please install OpenSSH.");
    logger.info("Windows: Settings > Apps > Optional Features > OpenSSH Client");
    logger.info("Linux/macOS: SSH is usually pre-installed.");
    return;
  }

  const server = await resolveServer(query, "Select a server to connect:");
  if (!server) return;

  if (options?.command) {
    logger.info(`Running command on ${server.name} (${server.ip})...`);
    const result = await sshExec(server.ip, raw(options.command));
    if (result.stdout) console.log(result.stdout);
    if (result.stderr) console.error(result.stderr);
    if (result.code !== 0) {
      logger.error(`Command exited with code ${result.code}`);
    }
  } else {
    logger.info(`Connecting to ${server.name} (${server.ip})...`);
    const exitCode = await sshConnect(server.ip);
    if (exitCode === 130) {
      // Ctrl+C — normal user-initiated exit, no warning needed
    } else if (exitCode !== 0) {
      logger.warning(`SSH session ended with code ${exitCode}`);
    }
  }
}
