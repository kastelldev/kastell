/**
 * Telegram bot lifecycle — foreground polling mode (D-01).
 * Resolves bot token from notifyStore, registers middleware and handlers,
 * starts grammy long polling with drop_pending_updates (TG-07).
 */

import { Bot } from "grammy";
import { readNotifySecret, loadAllowedChatIds } from "../notifyStore.js";
import { allowedChatIdsMiddleware } from "./middleware.js";
import { registerHandlers } from "./handlers.js";
import { ensureOffsetDir, saveOffset } from "./offset.js";
import { BusinessError } from "../../utils/errors.js";

export async function startBot(): Promise<void> {
  const token = readNotifySecret("telegram", "botToken");
  if (!token) {
    throw new BusinessError(
      "Telegram bot token not configured. Run: kastell notify add telegram",
      { hint: "Run: kastell notify add telegram to configure the bot token" },
    );
  }

  const bot = new Bot(token);

  // Ensure offset directory exists once at startup
  ensureOffsetDir();

  // Global auth middleware — D-10: enforce before any handler
  bot.use(allowedChatIdsMiddleware);

  // Command handlers
  registerHandlers(bot);

  // Offset persistence middleware — save last processed update_id after each update
  bot.use(async (ctx, next) => {
    await next();
    saveOffset(ctx.update.update_id);
  });

  // Warn about open access when allowedChatIds is empty (pitfall 3)
  if (loadAllowedChatIds().length === 0) {
    console.warn(
      "[kastell] Warning: allowedChatIds is empty — all chats accepted. " +
        "Restrict with: kastell notify allow-chat <chat-id>",
    );
  }

  // Signal handlers MUST be registered BEFORE bot.start() (pitfall 2)
  process.once("SIGINT", () => void bot.stop());
  process.once("SIGTERM", () => void bot.stop());

  // Start polling — blocks until bot.stop() is called (D-01: foreground)
  await bot.start({
    drop_pending_updates: true,
    allowed_updates: ["message"],
    onStart: (info) => {
      console.log(`Bot @${info.username} started (polling)`);
    },
  });
}
