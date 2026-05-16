import { parseHumanSize, parsePercent, buildMetrics } from "../../src/mcp/utils/parseMetrics";

describe("parseHumanSize (IEC binary)", () => {
  it.each([
    ["4.2G", 4.2 * 1024 ** 3],
    ["512M", 512 * 1024 ** 2],
    ["1024K", 1024 * 1024],
    ["0", 0],
    ["100", 100],
    ["1.5T", 1.5 * 1024 ** 4],
  ])("%s → %d bytes", (input, expected) => {
    expect(parseHumanSize(input)).toBeCloseTo(expected, 0);
  });

  it.each(["N/A", "", "abc"])("returns 0 for invalid %s", (input) => {
    expect(parseHumanSize(input)).toBe(0);
  });
});

describe("parsePercent", () => {
  it.each([["23.5%", 23.5], ["0%", 0], ["100%", 100], ["N/A", 0]])(
    "%s → %d",
    (input, expected) => expect(parsePercent(input)).toBeCloseTo(expected, 1),
  );
});

describe("buildMetrics", () => {
  it("produces structured metrics from flat string fields", () => {
    const m = buildMetrics({
      cpu: "23.5%",
      ramUsed: "2.1G", ramTotal: "4.2G",
      diskUsed: "10G", diskTotal: "100G", diskPercent: "10%",
    });
    expect(m.cpu.percent).toBeCloseTo(23.5, 1);
    expect(m.mem.total).toBeCloseTo(4.2 * 1024 ** 3, 0);
    expect(m.mem.used).toBeCloseTo(2.1 * 1024 ** 3, 0);
    expect(m.mem.percent).toBeCloseTo(50, 1);
    expect(m.disk.percent).toBeCloseTo(10, 1);
  });
});