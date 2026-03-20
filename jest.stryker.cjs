/** @type {import('ts-jest').JestConfigWithTsJest} */
// Jest config for Stryker mutation testing
// Limits worker count to prevent OOM on Windows during perTest coverage analysis

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
  coverageProvider: 'v8',
  maxWorkers: 1,
};
