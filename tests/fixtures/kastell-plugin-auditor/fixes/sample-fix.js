module.exports.fix = async function(checkId, ctx) {
  if (ctx.dryRun) {
    return { success: true, modifiedFiles: ["/etc/kastell-test.conf"] };
  }

  const result = await ctx.ssh("echo 'fixed' > /etc/kastell-test.conf", { timeoutMs: 10000 });
  return {
    success: result.code === 0,
    error: result.code !== 0 ? result.stderr : undefined,
    modifiedFiles: ["/etc/kastell-test.conf"],
  };
};
