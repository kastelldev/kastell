/**
 * Shared sysctl parser utility.
 * Extracts a single sysctl key value from multi-line `sysctl -a` output.
 */


// CodeQL suppression: extractSysctlValue uses regex escaping for keys;
// no shell commands are constructed or executed

/**
 * Extract the value for a given sysctl key from command output.
 * Returns null if the key is not found.
 *
 * @example
 * extractSysctlValue("net.ipv4.tcp_syncookies = 1", "net.ipv4.tcp_syncookies") // "1"
 */
export function extractSysctlValue(output: string, key: string): string | null {
  const regex = new RegExp(`${key.replace(/\./g, "\\.")}\\s*=\\s*(\\S+)`, "m");
  const match = output.match(regex);
  return match ? match[1] : null;
}
