/** @type {import('ts-jest').JestConfigWithTsJest} */

// Allow private IPs in test environment (tests use 192.168.x, 10.x mock IPs)
process.env.KASTELL_ALLOW_PRIVATE_IPS = 'true';

module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^chalk$': '<rootDir>/tests/__mocks__/chalk.ts',
    '^ora$': '<rootDir>/tests/__mocks__/ora.ts',
    '^inquirer$': '<rootDir>/tests/__mocks__/inquirer.ts',
    '^axios$': '<rootDir>/tests/__mocks__/axios.ts',
    '^@napi-rs/keyring$': '<rootDir>/tests/__mocks__/@napi-rs/keyring.ts',
    '^p-limit$': '<rootDir>/tests/__mocks__/p-limit.cjs',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.test.json',
    }],
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/index.ts',
  ],
  coverageProvider: 'v8',
  coverageDirectory: 'coverage',
  coverageThreshold: {
    global: {
      branches: 89,
      functions: 90,
      lines: 90,
      statements: 90,
    },
    './src/core/audit/': {
      branches: 95,
      functions: 95,
      lines: 95,
      statements: 95,
    },
    './src/providers/': {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
    './src/mcp/': {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
};
