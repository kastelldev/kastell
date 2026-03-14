/**
 * Mock for p-limit (pure ESM, not compatible with Jest CJS transform).
 * Pass-through limiter that runs tasks immediately.
 */

function pLimit(_concurrency) {
  return function limit(fn) {
    return fn();
  };
}

module.exports = pLimit;
module.exports.default = pLimit;
