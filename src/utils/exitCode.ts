export function markCommandFailed(): false {
  process.exitCode = 1;
  return false;
}
