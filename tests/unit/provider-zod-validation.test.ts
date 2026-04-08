import { ZodError } from "zod";
import { HetznerServerSchema } from "../../src/providers/hetzner.js";
import { DODropletSchema } from "../../src/providers/digitalocean.js";
import { VultrInstanceSchema } from "../../src/providers/vultr.js";
import { LinodeInstanceSchema } from "../../src/providers/linode.js";

describe("Provider Zod Schemas", () => {
  describe("HetznerServerSchema", () => {
    it("parses valid Hetzner response", () => {
      const data = { server: { id: 123, status: "running", public_net: { ipv4: { ip: "1.2.3.4" } } } };
      const result = HetznerServerSchema.parse(data);
      expect(result.server.id).toBe(123);
      expect(result.server.status).toBe("running");
    });

    it("parses response without ipv4", () => {
      const data = { server: { id: 456, status: "initializing" } };
      const result = HetznerServerSchema.parse(data);
      expect(result.server.id).toBe(456);
    });

    it("throws ZodError on missing server key", () => {
      expect(() => HetznerServerSchema.parse({ wrong: {} })).toThrow(ZodError);
    });

    it("throws ZodError on wrong id type", () => {
      expect(() => HetznerServerSchema.parse({ server: { id: "abc", status: "running" } })).toThrow(ZodError);
    });
  });

  describe("DODropletSchema", () => {
    it("parses valid DO response", () => {
      const data = { droplet: { id: 789, status: "active", networks: { v4: [{ type: "public", ip_address: "5.6.7.8" }] } } };
      const result = DODropletSchema.parse(data);
      expect(result.droplet.id).toBe(789);
    });

    it("parses response without networks", () => {
      const data = { droplet: { id: 100, status: "new" } };
      const result = DODropletSchema.parse(data);
      expect(result.droplet.id).toBe(100);
    });

    it("throws ZodError on missing droplet key", () => {
      expect(() => DODropletSchema.parse({ instance: {} })).toThrow(ZodError);
    });
  });

  describe("VultrInstanceSchema", () => {
    it("parses valid Vultr response", () => {
      const data = { instance: { id: "vtr-123", main_ip: "9.10.11.12", power_status: "running", server_status: "ok" } };
      const result = VultrInstanceSchema.parse(data);
      expect(result.instance.id).toBe("vtr-123");
      expect(result.instance.power_status).toBe("running");
    });

    it("parses response with null server_status", () => {
      const data = { instance: { id: "vtr-456", power_status: "stopped", server_status: null } };
      const result = VultrInstanceSchema.parse(data);
      expect(result.instance.server_status).toBeNull();
    });

    it("parses response without optional fields", () => {
      const data = { instance: { id: "vtr-789", power_status: "running" } };
      const result = VultrInstanceSchema.parse(data);
      expect(result.instance.main_ip).toBeUndefined();
    });

    it("throws ZodError on missing instance key", () => {
      expect(() => VultrInstanceSchema.parse({ server: {} })).toThrow(ZodError);
    });

    it("throws ZodError on wrong id type", () => {
      expect(() => VultrInstanceSchema.parse({ instance: { id: 123, power_status: "running" } })).toThrow(ZodError);
    });
  });

  describe("LinodeInstanceSchema", () => {
    it("parses valid Linode response", () => {
      const data = { id: 111, status: "running", ipv4: ["13.14.15.16"] };
      const result = LinodeInstanceSchema.parse(data);
      expect(result.id).toBe(111);
      expect(result.ipv4?.[0]).toBe("13.14.15.16");
    });

    it("parses response without ipv4", () => {
      const data = { id: 222, status: "provisioning" };
      const result = LinodeInstanceSchema.parse(data);
      expect(result.id).toBe(222);
      expect(result.ipv4).toBeUndefined();
    });

    it("throws ZodError on missing id", () => {
      expect(() => LinodeInstanceSchema.parse({ status: "running" })).toThrow(ZodError);
    });

    it("throws ZodError on wrong id type", () => {
      expect(() => LinodeInstanceSchema.parse({ id: "abc", status: "running" })).toThrow(ZodError);
    });
  });
});
