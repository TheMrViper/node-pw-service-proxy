'use strict';

const through2 = require('through2');

/**
 * @param {Function} handler
 * @return {Stream}
 */
module.exports = function (handler) {
    return through2.obj(handler);
};
