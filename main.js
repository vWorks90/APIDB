/*
 * APIDB Server
 * 
 * @author : Bismay <bismay@smartinfologiks.com>
 * */

global.CONFIG = require('./config/apidb');
global.CONNECTPARAMS = require('./config/connections');

/**
 * Loading all plugin packages required
 */
const restify = require('restify');
const restifyPlugins = require('restify').plugins;
const errors = require('restify-errors');
const bunyan = require('bunyan');


global.glob = require('glob');
global.fs = require('fs');
global.path = require('path');
global.moment = require('moment');
global.md5 = require('md5');
global._ = require('lodash');

/**
 * Create A Logger, may be we will remove this in future
 */
global.logger = bunyan.createLogger({
    name: CONFIG.name,
    streams: CONFIG.LOGGER,
});

const server = restify.createServer({
    name: CONFIG.name,
    version: CONFIG.version,

    dtrace: false,
    log: logger,
    ignoreTrailingSlash: true
});
server.config = CONFIG;
server.errors = errors;

//Core Restify Plugins
require('./api/plugins')(server, restify);
require('./api/misc')(server, restify);
require('./api/requests')(server, restify);
require('./api/middleware')(server, restify);
require('./api/security')(server, restify);

//Some common functions
global.__ = require('./api/datamaster');
global._CACHE = require('./api/cache');

//Loading Route Files
require('./api/routes/main')(server, restify);
require('./api/routes/data')(server, restify);

/**
 * Start Server, Checks for availale PORTs
 */
server.listen(CONFIG.port, () => {
    // console.log(config);

    console.log(`${CONFIG.name} is listening on port http://localhost:${CONFIG.port}`);
});