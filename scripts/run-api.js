/* eslint-disable */
const crypto = require('crypto');

if (!global.crypto) {
  global.crypto = crypto;
}

require('../dist/apps/api/main.js');
