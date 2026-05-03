import { raw, type SshCommand } from "../../utils/sshCommand.js";
import type { Platform } from "../../types/index.js";

export function buildDockerHardeningCommand(platform: Platform | undefined): SshCommand {
  const isCoolify = platform === "coolify";
  const isDokploy = platform === "dokploy";

  const settings: Record<string, unknown> = {
    "log-driver": "json-file",
    "log-opts": { "max-size": "10m", "max-file": "3" },
    "no-new-privileges": true,
  };

  if (!isDokploy) {
    settings["live-restore"] = true;
  }

  if (!isCoolify && !isDokploy) {
    settings["icc"] = false;
  }

  const hardeningJson = JSON.stringify(settings);

  return raw(
    [
      "command -v jq >/dev/null 2>&1 || { echo 'WARN: jq not found, skipping Docker hardening'; exit 0; }",
      "command -v docker >/dev/null 2>&1 || { echo 'WARN: Docker not installed, skipping Docker hardening'; exit 0; }",
      "mkdir -p /etc/docker && ([ -f /etc/docker/daemon.json ] || echo '{}' > /etc/docker/daemon.json)",
      "cp /etc/docker/daemon.json /etc/docker/daemon.json.bak-docker",
      `printf '%s' '${hardeningJson}' | jq -s '.[0] * .[1]' /etc/docker/daemon.json - > /tmp/daemon-kastell.json`,
      "jq -e . /tmp/daemon-kastell.json >/dev/null 2>&1 || { cp /etc/docker/daemon.json.bak-docker /etc/docker/daemon.json && echo 'daemon.json merge failed: rolled back' >&2 && exit 1; }",
      "mv /tmp/daemon-kastell.json /etc/docker/daemon.json",
      "systemctl reload docker 2>/dev/null || systemctl restart docker",
    ].join(" && "),
  );
}
