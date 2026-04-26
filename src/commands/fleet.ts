import type { Command } from "commander";
import { runFleet } from "../core/fleet.js";

export function fleetCommand(program: Command): void {
  program
    .command("fleet")
    .description("Show health and security posture of all registered servers")
    .option("--json", "Output machine-readable JSON")
    .option("--sort <field>", "Sort by: score, name, provider", "name")
    .option("--categories", "Show weakest audit category per server")
    .action(async (options: { json?: boolean; sort?: string; categories?: boolean }) => {
      await runFleet(options);
    });
}
