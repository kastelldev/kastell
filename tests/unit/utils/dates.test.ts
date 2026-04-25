import { formatRelativeTime, MS_PER_DAY } from "../../../src/utils/dates.js";

describe("dates", () => {
  describe("MS_PER_DAY", () => {
    it("equals 86400000", () => {
      expect(MS_PER_DAY).toBe(86_400_000);
    });
  });

  describe("formatRelativeTime", () => {
    it("returns 'today' for current time", () => {
      expect(formatRelativeTime(new Date())).toBe("today");
    });

    it("returns 'today' for ISO string from today", () => {
      expect(formatRelativeTime(new Date().toISOString())).toBe("today");
    });

    it("returns '1 day ago' for yesterday", () => {
      const yesterday = new Date(Date.now() - MS_PER_DAY);
      expect(formatRelativeTime(yesterday)).toBe("1 day ago");
    });

    it("returns 'N days ago' for older dates", () => {
      const fiveDaysAgo = new Date(Date.now() - 5 * MS_PER_DAY);
      expect(formatRelativeTime(fiveDaysAgo)).toBe("5 days ago");
    });

    it("returns 'today' for a date less than 24h ago", () => {
      const hoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
      expect(formatRelativeTime(hoursAgo)).toBe("today");
    });

    it("accepts string input", () => {
      const threeDaysAgo = new Date(Date.now() - 3 * MS_PER_DAY).toISOString();
      expect(formatRelativeTime(threeDaysAgo)).toBe("3 days ago");
    });
  });
});