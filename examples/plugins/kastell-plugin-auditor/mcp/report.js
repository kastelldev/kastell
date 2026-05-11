async function handler(args, ctx) {
  const serverInfo = ctx.server ?? "unknown";
  ctx.logger.info(`Generating report for ${serverInfo}`);
  return {
    summary: `Audit report for ${serverInfo}`,
    timestamp: new Date().toISOString(),
    status: "demo",
  };
}

module.exports = { handler };