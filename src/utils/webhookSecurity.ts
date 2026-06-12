import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { Agent } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { ValidationError } from "./errors.js";

type DnsResolver = (
  hostname: string,
  options: { all: true; verbatim: true },
  callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void;

type SafeLookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

const RESERVED_ADDRESSES = new BlockList();

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  RESERVED_ADDRESSES.addSubnet(network, prefix, "ipv4");
}

for (const [network, prefix] of [
  ["::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  RESERVED_ADDRESSES.addSubnet(network, prefix, "ipv6");
}

function normalizeAddress(address: string): string {
  if (address.startsWith("[") && address.endsWith("]")) {
    return address.slice(1, -1);
  }
  return address;
}

function mappedIpv4Address(address: string): string | undefined {
  const lower = address.toLowerCase();
  if (!lower.startsWith("::ffff:")) return undefined;

  const suffix = lower.slice("::ffff:".length);
  if (isIP(suffix) === 4) return suffix;

  const groups = suffix.split(":");
  if (groups.length !== 2) return undefined;
  const high = Number.parseInt(groups[0], 16);
  const low = Number.parseInt(groups[1], 16);
  if (
    !Number.isInteger(high) ||
    !Number.isInteger(low) ||
    high < 0 ||
    high > 0xffff ||
    low < 0 ||
    low > 0xffff
  ) {
    return undefined;
  }

  return [
    high >> 8,
    high & 0xff,
    low >> 8,
    low & 0xff,
  ].join(".");
}

export function isPublicWebhookAddress(address: string): boolean {
  const normalized = normalizeAddress(address);
  const mappedIpv4 = mappedIpv4Address(normalized);
  if (mappedIpv4) return isPublicWebhookAddress(mappedIpv4);

  const family = isIP(normalized);
  if (family === 0) return false;
  return !RESERVED_ADDRESSES.check(normalized, family === 4 ? "ipv4" : "ipv6");
}

function privateAddressError(hostname: string): NodeJS.ErrnoException {
  const error = new Error(
    `Webhook hostname "${hostname}" resolves to a private or reserved address`,
  ) as NodeJS.ErrnoException;
  error.code = "ENOTFOUND";
  return error;
}

export function createSafeWebhookLookup(
  resolver: DnsResolver = dnsLookup as DnsResolver,
): LookupFunction {
  return ((
    hostname: string,
    options: number | { all?: boolean; family?: number },
    callback: SafeLookupCallback,
  ): void => {
    resolver(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error) {
        callback(error, []);
        return;
      }

      const requestedFamily = typeof options === "number" ? options : options.family;
      const publicAddresses = addresses.filter(
        ({ address, family }) =>
          isPublicWebhookAddress(address) &&
          (!requestedFamily || requestedFamily === family),
      );

      if (publicAddresses.length === 0) {
        callback(privateAddressError(hostname), []);
        return;
      }

      const wantsAll = typeof options === "object" && options.all === true;
      if (wantsAll) {
        callback(null, publicAddresses);
        return;
      }

      const selected = publicAddresses[0];
      callback(null, selected.address, selected.family);
    });
  }) as LookupFunction;
}

export function assertSafeWebhookUrl(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new ValidationError("Webhook URL must use HTTPS", {
      hint: "Webhook URL must start with https://",
    });
  }

  const hostname = normalizeAddress(parsed.hostname);
  const normalizedHostname = hostname.toLowerCase().replace(/\.$/, "");
  const isLocalhost =
    normalizedHostname === "localhost" || normalizedHostname.endsWith(".localhost");
  if (
    isLocalhost ||
    (isIP(normalizedHostname) !== 0 && !isPublicWebhookAddress(normalizedHostname))
  ) {
    throw new ValidationError("Webhook URL points to a private/reserved address", {
      hint: "Use a public webhook URL",
    });
  }
}

export function createSafeWebhookAgent(): Agent {
  return new Agent({
    keepAlive: false,
    lookup: createSafeWebhookLookup(),
  });
}
