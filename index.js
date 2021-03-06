'use strict';

const net = require('net');
const async = require('async');
const transformStreamFactory = require('./transform-stream-factory');
const packetParserStreamFactory = require('./packet-parser-stream-factory');

class PwServiceProxy
{
    /**
     * @param {Object} options
     */
    constructor(options) {
        this._options = Object.assign({}, {
            bufferSize: 10485760,
            bufferFreeSpaceGc: 1048576,
            noDelay: true,
            consoleLog: false
        }, options || {});
        this._clientHandlers = [];
        this._serverHandlers = [];
    }

    /**
     * @private
     */
    _consoleLog() {
        if (this._options.consoleLog) {
            console.log.apply(console, arguments);
        }
    }

    /**
     * @param {Array} handlers
     * @return {Array}
     * @private
     */
    _prepareHandlersList(handlers) {
        let result = [];

        for (let i = 0; i < handlers.length; ++i) {
            if (Array.isArray(handlers[i])) {
                result = result.concat(this._prepareHandlersList(handlers[i]));
            } else {
                result.push(handlers[i]);
            }
        }

        return result;
    }

    /**
     * @param {Array} handlers
     * @param {Stream} input
     * @param {Stream} output
     * @return {Stream}
     * @private
     */
    _createHandlersStream(handlers, input, output) {
        return transformStreamFactory(function (packet, enc, streamDone) {
            let _thisStream = this;

            async.eachSeries(handlers, function (handler, next) {
                if (
                    handler.only && handler.only.indexOf(packet.opcode) === -1 ||
                    handler.except && handler.except.indexOf(packet.opcode) !== -1
                ) {
                    return next();
                }

                handler.handler(packet, input, output, next);
            }, function (err) {
                if (!err) {
                    packet.payload.writeCUInt(packet.payload.length, true).writeCUInt(packet.opcode, true);
                    _thisStream.push(packet.payload.buffer);
                }

                streamDone();
            });
        });
    }

    /**
     * @param {Object} options
     * @return {PwServiceProxy}
     */
    start(options) {
        let _this = this;

        net.createServer(function (clientSocket) {
            if (
                Array.isArray(options.allowedIp) && options.allowedIp.length && options.allowedIp.indexOf(clientSocket.remoteAddress) === -1 ||
                typeof options.allowedIp === 'string' && options.allowedIp && options.allowedIp !== clientSocket.remoteAddress ||
                typeof options.allowedIp === 'function' && !options.allowedIp(clientSocket)
            ) {
                return clientSocket.end().unref();
            }

            let remoteAddr = clientSocket.remoteAddress + ':' + clientSocket.remotePort;
            let alreadyClosed = false;
            let serverSocket = net.createConnection(options.connect, function () {
                clientSocket
                    .pipe(packetParserStreamFactory(_this._options))
                    .pipe(_this._createHandlersStream(_this._clientHandlers, clientSocket, serverSocket))
                    .pipe(serverSocket)
                    .pipe(packetParserStreamFactory(_this._options))
                    .pipe(_this._createHandlersStream(_this._serverHandlers, serverSocket, clientSocket))
                    .pipe(clientSocket);
            });

            function closeConnection() {
                if (!alreadyClosed) {
                    alreadyClosed = true;
                    clientSocket.end().unref();
                    serverSocket.end().unref();
                    _this._consoleLog('---------------------------------------------------------------------------');
                    _this._consoleLog('[' + new Date().toLocaleString() + ']: Client disconnected [' + remoteAddr + ']');
                }
            }

            serverSocket.on('close', closeConnection).on('error', closeConnection).setNoDelay(_this._options.noDelay);
            clientSocket.on('close', closeConnection).on('error', closeConnection).setNoDelay(_this._options.noDelay);
            _this._consoleLog('---------------------------------------------------------------------------');
            _this._consoleLog('[' + new Date().toLocaleString() + ']: Client connected [' + remoteAddr + ']');
        }).listen(options.listen, function () {
            _this._consoleLog('---------------------------------------------------------------------------');
            _this._consoleLog('[' + new Date().toLocaleString() + ']: Proxy start');
        }).on('error', function (err) {
            console.error('---------------------------------------------------------------------------');
            console.error('[' + new Date().toLocaleString() + ']: Proxy error');
            console.error(JSON.stringify(options, null, 2));
            console.error(err.stack);
            console.error('---------------------------------------------------------------------------');
        });

        return this;
    }

    /**
     * @param {Array} handlers
     * @return {PwServiceProxy}
     */
    setClientHandlers(handlers) {
        this._clientHandlers = this._prepareHandlersList(handlers);
        return this;
    }

    /**
     * @param {Array} handlers
     * @return {PwServiceProxy}
     */
    setServerHandlers(handlers) {
        this._serverHandlers = this._prepareHandlersList(handlers);
        return this;
    }
}

module.exports = PwServiceProxy;
