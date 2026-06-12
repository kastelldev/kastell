import type { LookupFunction } from "node:net";
import axios from "axios";
import {
  createSafeWebhookLookup,
  isPublicWebhookAddress,
} from "../../src/utils/webhookSecurity.js";
import { sendDiscord, sendSlack } from "../../src/core/notify.js";

const mockedAxiosPost = axios.post as jest.Mock;

function runLookup(lookup: LookupFunction, hostname: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    lookup(hostname, { all: true }, (error, addresses) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(addresses);
    });
  });
}

describe("webhook SSRF protection", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "192.168.1.10",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
  ])("rejects reserved address %s", (address) => {
    expect(isPublicWebhookAddress(address)).toBe(false);
  });

  it.each(["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])(
    "allows public address %s",
    (address) => {
      expect(isPublicWebhookAddress(address)).toBe(true);
    },
  );

  it("rejects a hostname when DNS resolves only to a private address", async () => {
    const resolver = jest.fn((_hostname, _options, callback) => {
      callback(null, [{ address: "127.0.0.1", family: 4 }]);
    });
    const lookup = createSafeWebhookLookup(resolver);

    await expect(runLookup(lookup, "attacker.example")).rejects.toThrow(
      "private or reserved",
    );
  });

  it("pins the connection lookup to public DNS answers", async () => {
    const resolver = jest.fn((_hostname, _options, callback) => {
      callback(null, [
        { address: "10.0.0.1", family: 4 },
        { address: "93.184.216.34", family: 4 },
      ]);
    });
    const lookup = createSafeWebhookLookup(resolver);

    await expect(runLookup(lookup, "webhook.example")).resolves.toEqual([
      { address: "93.184.216.34", family: 4 },
    ]);
  });

  it("blocks literal private webhook URLs before making a request", async () => {
    await expect(sendDiscord("https://127.0.0.1/hook", "message")).rejects.toThrow(
      "private/reserved",
    );

    expect(mockedAxiosPost).not.toHaveBeenCalled();
  });

  it("blocks IPv6 loopback webhook URLs before making a request", async () => {
    await expect(sendSlack("https://[::1]/hook", "message")).rejects.toThrow(
      "private/reserved",
    );

    expect(mockedAxiosPost).not.toHaveBeenCalled();
  });

  it("disables redirects and environment proxies for webhook requests", async () => {
    mockedAxiosPost.mockResolvedValue({ status: 204 });

    await sendDiscord("https://discord.com/api/webhooks/1/token", "message");

    expect(mockedAxiosPost).toHaveBeenCalledWith(
      "https://discord.com/api/webhooks/1/token",
      { content: "message" },
      expect.objectContaining({
        timeout: 10_000,
        maxRedirects: 0,
        proxy: false,
        httpsAgent: expect.any(Object),
      }),
    );
  });
});
