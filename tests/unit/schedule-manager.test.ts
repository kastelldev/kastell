/**
 * Unit tests for DOC-04: doctor-fix schedule support in scheduleManager.ts
 */

import {
  scheduleKey,
  parseScheduleKey,
  SCHEDULE_MARKERS,
  sanitizeServerName,
  type ScheduleType,
} from "../../src/core/scheduleManager";

describe("scheduleManager — doctor-fix type (DOC-04)", () => {
  describe("SCHEDULE_MARKERS", () => {
    it("has doctor-fix marker", () => {
      expect(SCHEDULE_MARKERS["doctor-fix"]).toBe("# kastell-doctor-fix-schedule");
    });

    it("has fix and audit markers too", () => {
      expect(SCHEDULE_MARKERS["fix"]).toBe("# kastell-fix-schedule");
      expect(SCHEDULE_MARKERS["audit"]).toBe("# kastell-audit-schedule");
    });
  });

  describe("scheduleKey / parseScheduleKey", () => {
    it("round-trips doctor-fix type correctly", () => {
      const key = scheduleKey("my-server", "doctor-fix");
      expect(key).toBe("my-server:doctor-fix");

      const parsed = parseScheduleKey(key);
      expect(parsed).toEqual({ server: "my-server", type: "doctor-fix" });
    });

    it("round-trips fix and audit types", () => {
      expect(parseScheduleKey(scheduleKey("srv", "fix"))?.type).toBe("fix");
      expect(parseScheduleKey(scheduleKey("srv", "audit"))?.type).toBe("audit");
    });

    it("parseScheduleKey returns null for unknown type", () => {
      const parsed = parseScheduleKey("server:unknown-type");
      expect(parsed).toBeNull();
    });

    it("parseScheduleKey returns null for malformed key", () => {
      expect(parseScheduleKey("no-colon-here")).toBeNull();
    });
  });

  describe("sanitizeServerName", () => {
    it("accepts valid server names", () => {
      expect(sanitizeServerName("my-server")).toBe("my-server");
      expect(sanitizeServerName("server_123")).toBe("server_123");
      expect(sanitizeServerName("web.prod.eu")).toBe("web.prod.eu");
    });

    it("rejects invalid server names", () => {
      expect(() => sanitizeServerName("my server")).toThrow();
      expect(() => sanitizeServerName("server;rm -rf")).toThrow();
      expect(() => sanitizeServerName("server$var")).toThrow();
    });
  });
});
