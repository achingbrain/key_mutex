var $ = {};
module.exports = $;

$.isMaster = true;
$.on = () => {};

try {
  module.exports = require('cluster');
} catch (error) {
  // ignore
}
