/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: 'npm',
  testRunner: 'jest',
  jest: {
    projectType: 'custom',
    configFile: 'jest.stryker.cjs',
  },
  testRunnerNodeArgs: ['--experimental-vm-modules', '--max-old-space-size=2048'],
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.json',
  mutate: [
    'src/core/**/*.ts',
    '!src/core/**/*.test.ts',
    '!src/core/**/__tests__/**',
    '!src/core/**/types.ts',
  ],
  reporters: ['html', 'json', 'progress'],
  htmlReporter: {
    fileName: 'reports/mutation/mutation.html',
  },
  jsonReporter: {
    fileName: 'reports/mutation/mutation.json',
  },
  coverageAnalysis: 'perTest',
  concurrency: 2,
  timeoutMS: 60000,
  timeoutFactor: 1.5,
  logLevel: 'info',
  thresholds: { high: 80, low: 60, break: null },
};
