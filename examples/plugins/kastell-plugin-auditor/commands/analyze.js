async function handler(args, ctx) {
  ctx.logger.info("[kastell-plugin-auditor] Analyze command executed");
  ctx.logger.info("This is a demo command — in production, this would analyze audit results.");
}

module.exports = { handler };