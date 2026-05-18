/**
 * Shared fs mock factory for test files.
 * Standardizes mock shape across all test suites.
 */

import { jest } from "@jest/globals";

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
    ...overrides,
  };
}