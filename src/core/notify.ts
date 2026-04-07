import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { z } from "zod";
import axios from "axios";
import chalk from "chalk";
import inquirer from "inquirer";
import { KASTELL_DIR } from "../utils/paths.js";
import { ValidationError } from "../utils/errors.js";
import { createSpinner } from "../utils/logger.js";
import { loadNotifyChannels, saveNotifyChannel, removeNotifyChannel } from "./notifyStore.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const COOLDOWN_FILE = join(KASTELL_DIR, "notify-cooldown.json");
const COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
const NOTIFY_TIMEOUT_MS = 10_000;

// ─── SSRF Protection ─────────────────────────────────────────────────────────

const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\./,
  /^localhost$/i,
];

function assertSafeWebhookUrl(url: string): void {
  const parsed = new URL(url);
  if (PRIVATE_IP_PATTERNS.some((p) => p.test(parsed.hostname))) {
    throw new ValidationError("Webhook URL points to a private/reserved address", { hint: "Use a public webhook URL" });
  }
  if (parsed.protocol !== "https:") {
    throw new ValidationError("Webhook URL must use HTTPS", { hint: "Webhook URL must start with https://" });
  }
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const TelegramChannelSchema = z.object({
  botToken: z.string().regex(/^\d+:[A-Za-z0-9_-]+$/, "Invalid Telegram bot token format"),
  chatId: z.string().min(1),
});

const WebhookChannelSchema = z.object({
  webhookUrl: z.string().url(),
});

export const NotifyConfigSchema = z.object({
  telegram: TelegramChannelSchema.optional(),
  discord: WebhookChannelSchema.optional(),
  slack: WebhookChannelSchema.optional(),
});

const CooldownStateSchema = z.record(z.string(), z.string());

// ─── Types ────────────────────────────────────────────────────────────────────

export type NotifyConfig = z.infer<typeof NotifyConfigSchema>;

export interface ChannelResult {
  channel: "telegram" | "discord" | "slack";
  success: boolean;
  error?: string;
}

// ─── Config Management ────────────────────────────────────────────────────────

export function loadNotifyConfig(): NotifyConfig {
  return loadNotifyChannels();
}

// ─── Channel Dispatchers ──────────────────────────────────────────────────────

async function sendHttp(
  url: string,
  body: Record<string, unknown>,
): Promise<{ success: boolean; error?: string }> {
  try {
    await axios.post(url, body, { timeout: NOTIFY_TIMEOUT_MS });
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function sendTelegram(
  botToken: string,
  chatId: string,
  text: string,
): Promise<{ success: boolean; error?: string }> {
  // Validate bot token format to prevent URL manipulation (security audit MEDIUM-006)
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(botToken)) {
    return { success: false, error: "Invalid Telegram bot token format" };
  }
  return sendHttp(`https://api.telegram.org/bot${botToken}/sendMessage`, { chat_id: chatId, text });
}

export async function sendDiscord(
  webhookUrl: string,
  content: string,
): Promise<{ success: boolean; error?: string }> {
  assertSafeWebhookUrl(webhookUrl);
  return sendHttp(webhookUrl, { content });
}

export async function sendSlack(
  webhookUrl: string,
  text: string,
): Promise<{ success: boolean; error?: string }> {
  assertSafeWebhookUrl(webhookUrl);
  return sendHttp(webhookUrl, { text });
}

// ─── Fan-out ──────────────────────────────────────────────────────────────────

export async function dispatchNotification(
  message: string,
  config?: NotifyConfig,
): Promise<ChannelResult[]> {
  const cfg = config ?? loadNotifyConfig();
  const tasks: Promise<ChannelResult>[] = [];

  if (cfg.telegram) {
    tasks.push(
      sendTelegram(cfg.telegram.botToken, cfg.telegram.chatId, message).then(
        (r) => ({ channel: "telegram" as const, ...r }),
      ),
    );
  }
  if (cfg.discord) {
    tasks.push(
      sendDiscord(cfg.discord.webhookUrl, message).then(
        (r) => ({ channel: "discord" as const, ...r }),
      ),
    );
  }
  if (cfg.slack) {
    tasks.push(
      sendSlack(cfg.slack.webhookUrl, message).then(
        (r) => ({ channel: "slack" as const, ...r }),
      ),
    );
  }

  return Promise.all(tasks);
}

// ─── Cooldown State ───────────────────────────────────────────────────────────

export function loadCooldownState(): Record<string, string> {
  if (!existsSync(COOLDOWN_FILE)) return {};
  try {
    const result = CooldownStateSchema.safeParse(
      JSON.parse(readFileSync(COOLDOWN_FILE, "utf-8")),
    );
    return result.success ? result.data : {};
  } catch {
    return {};
  }
}

export function saveCooldownState(state: Record<string, string>): void {
  mkdirSync(KASTELL_DIR, { recursive: true });
  writeFileSync(COOLDOWN_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
}

export async function dispatchWithCooldown(
  serverName: string,
  findingType: string,
  message: string,
): Promise<{ skipped: boolean; results: ChannelResult[] }> {
  const key = `${serverName}:${findingType}`;
  const state = loadCooldownState();
  const lastSent = state[key];
  if (lastSent && Date.now() - new Date(lastSent).getTime() < COOLDOWN_MS) {
    return { skipped: true, results: [] };
  }
  const results = await dispatchNotification(message);
  const anySuccess = results.some((r) => r.success);
  if (anySuccess) {
    state[key] = new Date().toISOString();
    saveCooldownState(state);
  }
  return { skipped: false, results };
}

// ─── Channel Management ───────────────────────────────────────────────────────

const VALID_CHANNELS = ["telegram", "discord", "slack"] as const;
type ValidChannel = (typeof VALID_CHANNELS)[number];

function validateChannel(channelName: string): channelName is ValidChannel {
  if (!VALID_CHANNELS.includes(channelName as ValidChannel)) {
    console.error(
      chalk.red(
        `Invalid channel: "${channelName}". Valid options: ${VALID_CHANNELS.join(", ")}`,
      ),
    );
    return false;
  }
  return true;
}

export interface AddChannelOptions {
  force?: boolean;
  botToken?: string;
  chatId?: string;
  webhookUrl?: string;
}

export async function addChannel(
  channelName: string,
  options: AddChannelOptions,
): Promise<void> {
  if (!validateChannel(channelName)) return;

  const channel = channelName;
  let channelConfig: NotifyConfig[ValidChannel];

  if (options.force) {
    if (channel === "telegram") {
      if (!options.botToken || !options.chatId) {
        console.error(
          chalk.red("Telegram requires --bot-token and --chat-id when using --force"),
        );
        return;
      }
      channelConfig = { botToken: options.botToken, chatId: options.chatId };
    } else {
      if (!options.webhookUrl) {
        console.error(
          chalk.red(`${channel} requires --webhook-url when using --force`),
        );
        return;
      }
      channelConfig = { webhookUrl: options.webhookUrl };
    }
  } else {
    if (channel === "telegram") {
      const answers = await inquirer.prompt([
        { type: "input", name: "botToken", message: "Telegram bot token:" },
        { type: "input", name: "chatId", message: "Telegram chat ID:" },
      ]);
      channelConfig = { botToken: answers.botToken as string, chatId: answers.chatId as string };
    } else {
      const answers = await inquirer.prompt([
        {
          type: "input",
          name: "webhookUrl",
          message: `${channel.charAt(0).toUpperCase() + channel.slice(1)} webhook URL:`,
        },
      ]);
      channelConfig = { webhookUrl: answers.webhookUrl as string };
    }
  }

  saveNotifyChannel(channel, channelConfig!);
  console.log(chalk.green(`${channel} notification channel configured successfully.`));
}

export function removeChannel(channelName: string): void {
  if (!validateChannel(channelName)) return;
  removeNotifyChannel(channelName);
  console.log(chalk.green(`${channelName} notification channel removed.`));
}

export async function testChannel(channelName: string): Promise<void> {
  if (!validateChannel(channelName)) return;

  const channel = channelName;
  const config = loadNotifyConfig();

  if (!config[channel]) {
    console.error(
      chalk.red(
        `${channel} is not configured. Run: kastell notify add ${channel}`,
      ),
    );
    return;
  }

  const spinner = createSpinner(`Sending test notification to ${channel}...`);
  spinner.start();
  const testMessage = `[Kastell] Test notification - your ${channel} integration is working!`;

  let result: { success: boolean; error?: string };

  if (channel === "telegram") {
    const { botToken, chatId } = config.telegram!;
    result = await sendTelegram(botToken, chatId, testMessage);
  } else if (channel === "discord") {
    result = await sendDiscord(config.discord!.webhookUrl, testMessage);
  } else {
    result = await sendSlack(config.slack!.webhookUrl, testMessage);
  }

  spinner.stop();

  if (result.success) {
    console.log(chalk.green(`Test notification sent to ${channel} successfully.`));
  } else {
    console.error(chalk.red(`Failed to send test notification to ${channel}: ${result.error}`));
  }
}
