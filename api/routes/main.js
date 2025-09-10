/*
 * All Routing Logic is written here
 * 
 * */
module.exports = function (server, restify) {

  server.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", req.header("Access-Control-Request-Method"));
    res.header("Access-Control-Allow-Headers", req.header("Access-Control-Request-Headers"));

    next();
  });

  server.opts("*", function (req, res, next) {
    res.send(200);
    return next();
  });

  server.get('*', (req, res, next) => {
    res.send(404);
    return next();
  });

  server.get('/', (req, res, next) => {
    if (CONFIG.allow_home_info) {
      console.log(1)
      res.header('content-type', 'json');
      res.send({
        "SERVER": server.config.name,
        "VERSION": server.config.version,
        "TIMESTAMP": new Date()
      });
    } else {
      res.header('content-type', 'json');
      res.send({
        "SERVER": server.config.name,
        "TIMESTAMP": new Date()
      });
    }
    return next();
  });

  server.get('/admin', (req, res, next) => {
    res.header('content-type', 'json');
    res.send([

    ]);
    return next();
  });
  server.get('/admin/_stats', (req, res, next) => {
    var os = require('os');

    res.header('content-type', 'json');
    res.send({
      "SERVER": server.config.name,
      "VERSION": server.config.version,
      "TIMESTAMP": new Date(),
      "totalmem": Math.floor((os.totalmem() / (1024 * 1024))) + " MB",
      "freemem": Math.floor((os.freemem() / (1024 * 1024))) + " MB",
      "processmem": Math.floor(process.memoryUsage().heapUsed / (1024 * 1024)) + " MB",
      "cpus": os.cpus().length,
      "cachestatus": _CACHE.cacheStatus(),
      "connections": __.getConnectionLength(),
    });
    return next();
  });

  server.get('/admin/_list', (req, res, next) => {
    res.header('content-type', 'json');
    connectionList = Object.keys(CONNECTPARAMS);
    res.send(connectionList);
    return next();
  });

  server.get('/admin/_debug', (req, res, next) => {
    if (!CONFIG.debug) {
      res.send(404);
      return next();
    }
    res.header('content-type', 'json');
    res.send({
      "DEBUG": CONFIG.debug || "",
      "BODY": req.body || "",
      "QUERY": req.query || "",
      "PARAMS": req.params || "",
      "HEADERS": req.headers || "",
      //"GUID":req.get("GUID"),
      //"DEVID":req.body.devid,

      "CONNECT": CONNECTPARAMS || ""
    });
    return next();
  });

  server.get('/admin/restart', (req, res, next) => {
    res.header('content-type', 'json');
    res.send({ "status": "ok" });
    res.once('finish', () => {
      console.log('Response sent, exiting now...');
      process.exit(0);
    });
    return next();
  });

  server.get('/admin/cache_clear', (req, res, next) => {
    dbKey = req.header("x-apidb-dbkey");
    
    if(dbKey==null) {
      _CACHE.clearCache();
    } else {
      _CACHE.clearCache(dbKey+":*");
    }
    
    res.header('content-type', 'json');
    res.send({"status":true});
    return next();
  });
}
