/**
 * Shared fs mock factory for test files.
 * Standardizes mock shape across all test suites.
 */

import { jest } from "@jest/globals";
import type { Stats } from "fs";

export interface FsMockOptions {
  readFileSync?: jest.Mock;
  writeFileSync?: jest.Mock;
  chmodSync?: jest.Mock;
  mkdirSync?: jest.Mock;
  existsSync?: jest.Mock;
  statSync?: jest.Mock;
  unlinkSync?: jest.Mock;
}

export function createFsMock(overrides: FsMockOptions = {}) {
  return {
    readFileSync: jest.fn(),
    writeFileSync: jest.fn(),
    chmodSync: jest.fn(),
    mkdirSync: jest.fn(),
    existsSync: jest.fn().mockReturnValue(false),
    statSync: jest.fn(),
    unlinkSync: jest.fn(),
    renameSync: jest.fn(),
    ...overrides,
  };
}

/** Cast a partial object to a `fs.Stats` for stat-mock return values. */
export const asStats = (obj: object): Stats => obj as unknown as Stats;

/** Stringify data and cast to the `string` return type of `fs.readFileSync`. */
export const jsonString = (data: unknown): string => JSON.stringify(data) as unknown as string;