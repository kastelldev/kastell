import chalk from "chalk";

const c1 = chalk.hex("#00ffff");
const c2 = chalk.hex("#00ccff");
const c3 = chalk.hex("#1e6fff");
const c4 = chalk.hex("#1a4acc");
const c5 = chalk.hex("#0d2a8c");

const dim = chalk.hex("#1e4a6e");
const sep = chalk.hex("#1e3a5f");
const accent = chalk.hex("#1e6fff");
const prompt = chalk.hex("#00d4ff");
const cmdName = chalk.hex("#e6edf3");
const cmdArg = chalk.hex("#1e6fff");
const arrow = chalk.hex("#1e3a5f");
const desc = chalk.hex("#1e4a6e");

const ASCII_ART = [
  c1(` ██╗  ██╗  ██████╗  ███████╗████████╗███████╗██╗     ██╗`),
  c2(` ██║ ██╔╝  ██╔══██╗ ██╔════╝╚══██╔══╝██╔════╝██║     ██║`),
  c3(` █████╔╝   ███████║ ███████╗   ██║   █████╗  ██║     ██║`),
  c4(` ██╔═██╗   ██╔══██║ ╚════██║   ██║   ██╔══╝  ██║     ██║`),
  c5(` ██║  ██╗  ██║  ██║ ███████║   ██║   ███████╗███████╗███████╗`),
  c5(` ╚═╝  ╚═╝  ╚═╝  ╚═╝ ╚══════╝   ╚═╝   ╚══════╝╚══════╝╚══════╝`),
];

export function printHeader(version: string): void {
  console.log();
  for (const line of ASCII_ART) {
    console.log(line);
  }
  console.log();
  console.log(
    `  ${chalk.white.bold("KASTELL")}  ${dim(`v${version}`)}  ${sep("·")}  ${accent("Your infrastructure, fortified.")}`,
  );
  console.log();
}

export function printQuickHelp(): void {
  const commands = [
    { cmd: "kastell init ", arg: "--template production", d: "deploy a new server" },
    { cmd: "kastell status ", arg: "--all", d: "check all servers" },
    { cmd: "kastell secure ", arg: "setup", d: "harden SSH + fail2ban" },
    { cmd: "kastell maintain ", arg: "--all", d: "full maintenance cycle" },
  ];

  for (const { cmd, arg, d } of commands) {
    const parts = [
      `  ${prompt("$")} ${cmdName(cmd)}`,
      arg ? cmdArg(arg) : "",
      ` ${arrow("→")} ${desc(d)}`,
    ];
    console.log(parts.filter(Boolean).join(""));
  }
  console.log();
}
