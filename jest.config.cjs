/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^chalk$': '<rootDir>/tests/__mocks__/chalk.ts',
    '^ora$': '<rootDir>/tests/__mocks__/ora.ts',
    '^inquirer$': '<rootDir>/tests/__mocks__/inquirer.ts',
    '^axios$': '<rootDir>/tests/__mocks__/axios.ts',
    '^figlet$': '<rootDir>/tests/__mocks__/figlet.ts',
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
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
};
