const checks = [
  {
    id: "AUD-SSH-CUSTOM-PORT",
    name: "SSH custom port",
    category: "Custom Audit",
    severity: "critical",
    description: "Verifies SSH is not running on default port 22",
    checkCommand: "grep '^Port ' /etc/ssh/sshd_config | awk '{print $2}'",
    failPattern: "^22$",
  },
  {
    id: "AUD-FAIL2BAN-ACTIVE",
    name: "fail2ban active",
    category: "Custom Audit",
    severity: "warning",
    description: "Checks that fail2ban service is running",
    checkCommand: "systemctl is-active fail2ban",
    passPattern: "^active$",
  },
];

const commands = [
  { name: "analyze", description: "Analyze audit results", handler: "./commands/analyze.js" },
];

const mcpTools = [
  { name: "report", description: "Generate audit summary report", handler: "./mcp/report.js" },
];

module.exports = { checks, commands, mcpTools };
