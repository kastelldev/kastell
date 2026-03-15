import type { Command } from "commander";
import { addChannel, testChannel, removeChannel } from "../core/notify.js";

export function notifyCommand(program: Command): void {
  const notify = program
    .command("notify")
    .description("Manage notification channels");

  notify
    .command("add <channel>")
    .description("Configure a notification channel (telegram, discord, slack)")
    .option("--bot-token <token>", "Telegram bot token")
    .option("--chat-id <id>", "Telegram chat ID")
    .option("--webhook-url <url>", "Discord or Slack webhook URL")
    .option("--force", "Skip interactive prompts, use CLI args directly")
    .action(
      async (
        channel: string,
        options: {
          botToken?: string;
          chatId?: string;
          webhookUrl?: string;
          force?: boolean;
        },
      ) => {
        await addChannel(channel, options);
      },
    );

  notify
    .command("test <channel>")
    .description("Send a test notification to the specified channel")
    .action(async (channel: string) => {
      await testChannel(channel);
    });

  notify
    .command("remove <channel>")
    .description("Remove a configured notification channel (telegram, discord, slack)")
    .action((channel: string) => {
      removeChannel(channel);
    });
}
