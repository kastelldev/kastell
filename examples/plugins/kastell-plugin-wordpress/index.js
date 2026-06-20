/**
 * kastell-plugin-wordpress — Plugin API v3 read-only example.
 *
 * The three v2 read checks (WP-FILE-PERMS, WP-CONFIG-SECURE, WP-DEBUG-OFF)
 * map 1:1 to v3 `read` objects. IDs, order, severity, and passPattern are
 * preserved verbatim from the v2 contract.
 */
export const checks = [
  {
    id: "WP-FILE-PERMS",
    name: "WordPress file permissions",
    category: "WordPress",
    severity: "warning",
    description: "Checks for world-writable files in the WordPress directory",
    read: {
      cmd: "find /var/www/html -type f -perm -002 | wc -l",
      passPattern: "^0$",
    },
  },
  {
    id: "WP-CONFIG-SECURE",
    name: "wp-config.php permissions",
    category: "WordPress",
    severity: "critical",
    description: "Verifies wp-config.php has restrictive file permissions (400 or 600)",
    read: {
      cmd: "stat -c %a /var/www/html/wp-config.php",
      passPattern: "^[46]00$",
    },
  },
  {
    id: "WP-DEBUG-OFF",
    name: "WP_DEBUG disabled in production",
    category: "WordPress",
    severity: "warning",
    description: "Ensures WP_DEBUG is not enabled in production",
    read: {
      cmd: "grep -c 'WP_DEBUG.*true' /var/www/html/wp-config.php",
      passPattern: "^0$",
    },
  },
];
