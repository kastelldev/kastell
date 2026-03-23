/**
 * Unit tests for CloudProvider.findServerByIp across all 4 providers.
 *
 * Covers:
 *   CLOUD-06: Hetzner IP→ID resolution (found)
 *   CLOUD-07: Hetzner IP→ID resolution (not found)
 *   CLOUD-08: DigitalOcean public-IP filter (found vs private-only)
 *   Vultr and Linode found/not-found paths
 */

import axios from "axios";
import { HetznerProvider } from "../../src/providers/hetzner";
import { DigitalOceanProvider } from "../../src/providers/digitalocean";
import { VultrProvider } from "../../src/providers/vultr";
import { LinodeProvider } from "../../src/providers/linode";

// axios is auto-mocked via tests/__mocks__/axios.ts.
// axios.create() returns the same mock object, so all apiClient.get calls
// are intercepted by mockedAxios.get.
const mockedAxios = axios as jest.Mocked<typeof axios>;

// ─── Hetzner ──────────────────────────────────────────────────────────────────

describe("HetznerProvider.findServerByIp", () => {
  let provider: HetznerProvider;

  beforeEach(() => {
    provider = new HetznerProvider("test-token");
    jest.resetAllMocks();
  });

  it("CLOUD-06: returns server ID string when IP matches", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        servers: [
          { id: 12345, public_net: { ipv4: { ip: "1.2.3.4" } } },
          { id: 99, public_net: { ipv4: { ip: "9.9.9.9" } } },
        ],
      },
    });

    const result = await provider.findServerByIp("1.2.3.4");

    expect(result).toBe("12345");
    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringContaining("/servers?per_page=100"),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer test-token" }) }),
    );
  });

  it("CLOUD-07: returns null when no server matches the IP", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        servers: [
          { id: 99, public_net: { ipv4: { ip: "9.9.9.9" } } },
        ],
      },
    });

    const result = await provider.findServerByIp("1.2.3.4");

    expect(result).toBeNull();
  });

  it("returns null when server list is empty", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { servers: [] },
    });

    const result = await provider.findServerByIp("1.2.3.4");

    expect(result).toBeNull();
  });
});

// ─── DigitalOcean ─────────────────────────────────────────────────────────────

describe("DigitalOceanProvider.findServerByIp", () => {
  let provider: DigitalOceanProvider;

  beforeEach(() => {
    provider = new DigitalOceanProvider("test-token");
    jest.resetAllMocks();
  });

  it("CLOUD-08: returns droplet ID when public IP matches", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        droplets: [
          {
            id: 456,
            networks: {
              v4: [
                { type: "private", ip_address: "10.0.0.1" },
                { type: "public", ip_address: "1.2.3.4" },
              ],
            },
          },
        ],
      },
    });

    const result = await provider.findServerByIp("1.2.3.4");

    expect(result).toBe("456");
    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringContaining("/droplets?per_page=100"),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer test-token" }) }),
    );
  });

  it("CLOUD-08: returns null when only private IP matches (public IP filter)", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        droplets: [
          {
            id: 456,
            networks: {
              v4: [
                { type: "private", ip_address: "10.0.0.1" },
                { type: "public", ip_address: "5.5.5.5" },
              ],
            },
          },
        ],
      },
    });

    // Searching for the private IP must return null — it is excluded by type==="public" filter
    const result = await provider.findServerByIp("10.0.0.1");

    expect(result).toBeNull();
  });

  it("returns null when no droplet public IP matches", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        droplets: [
          {
            id: 789,
            networks: { v4: [{ type: "public", ip_address: "2.2.2.2" }] },
          },
        ],
      },
    });

    const result = await provider.findServerByIp("1.2.3.4");

    expect(result).toBeNull();
  });
});

// ─── Vultr ────────────────────────────────────────────────────────────────────

describe("VultrProvider.findServerByIp", () => {
  let provider: VultrProvider;

  beforeEach(() => {
    provider = new VultrProvider("test-token");
    jest.resetAllMocks();
  });

  it("returns instance UUID string when main_ip matches", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        instances: [
          { id: "uuid-abc", main_ip: "1.2.3.4" },
          { id: "uuid-xyz", main_ip: "9.9.9.9" },
        ],
      },
    });

    const result = await provider.findServerByIp("1.2.3.4");

    expect(result).toBe("uuid-abc");
    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringContaining("/instances?per_page=100"),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer test-token" }) }),
    );
  });

  it("returns null when no instance main_ip matches", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        instances: [{ id: "uuid-xyz", main_ip: "9.9.9.9" }],
      },
    });

    const result = await provider.findServerByIp("1.2.3.4");

    expect(result).toBeNull();
  });
});

// ─── Linode ───────────────────────────────────────────────────────────────────

describe("LinodeProvider.findServerByIp", () => {
  let provider: LinodeProvider;

  beforeEach(() => {
    provider = new LinodeProvider("test-token");
    jest.resetAllMocks();
  });

  it("returns instance ID string when ipv4 array includes the IP", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        data: [
          { id: 789, ipv4: ["1.2.3.4", "10.0.0.1"] },
          { id: 999, ipv4: ["8.8.8.8"] },
        ],
      },
    });

    const result = await provider.findServerByIp("1.2.3.4");

    expect(result).toBe("789");
    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringContaining("/linode/instances?page_size=100"),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer test-token" }) }),
    );
  });

  it("returns null when no instance ipv4 array includes the IP", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        data: [{ id: 999, ipv4: ["8.8.8.8", "10.0.0.1"] }],
      },
    });

    const result = await provider.findServerByIp("1.2.3.4");

    expect(result).toBeNull();
  });
});
