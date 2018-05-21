var $ = {};
module.exports = $;

try {
  module.exports = require('net');
} catch (error) {
  // ignore
}
