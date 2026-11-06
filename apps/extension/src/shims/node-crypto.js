const crypto = require('crypto-browserify');
const shim = { ...crypto };
shim.default = shim;
Object.defineProperty(shim, '__esModule', { value: true });
module.exports = shim;
