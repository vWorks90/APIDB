/*
 * All Routing Logic for database related tasks
 * 
 * */
module.exports = function (server, restify) {

  server.get('/_tables', (req, res, next) => {
    console.log("Fetching Tables List", req.getPath(), "method:", req.method, "Header:  ", req.headers);
    dbKey = req.header("x-apidb-dbkey");

    __.getDataConnection(dbKey, function (dataConnection) {
      if (!dataConnection) {
        return next(
          new server.errors.ForbiddenError("APIKEY Not Registered")
        );
      }

      dataConnection.listTables(function (collectionList) {
        res.header('content-type', 'json');
        res.send(collectionList);
        return next();
      });
    });
  });

  server.get('/:tableName', (req, res, next) => {
    dbKey = req.header("x-apidb-dbkey");
    tblName = req.params['tableName'];
    if (tblName == null || tblName.length <= 0) {
      return next(
        new server.errors.ForbiddenError("Missing Table Name")
      );
    }

    __.getDataConnection(dbKey, function (dataConnection) {
      if (!dataConnection) {
        return next(
          new server.errors.ForbiddenError("APIKEY Not Registered")
        );
      }

      sortBy = false;
      columns = null;
      filter = null;
      if (req.query['orderby'] != null && req.query['orderby'].length > 0) sortBy = req.query['orderby'];
      if (req.query['columns'] != null && req.query['columns'].length > 0) columns = req.query['columns'].split(",");
      try {
        if (req.query['filter'] != null && req.query['filter'].length > 0) filter = JSON.parse(req.query['filter']);
      } catch (e) {

      }
      // console.log(typeof filter,filter);

      dataConnection.listData({
        "dbkey": dbKey,
        "table": tblName,
        "columns": columns,
        "orderby": sortBy,
        "filter": filter
      }, function (recordSet) {
        res.header('content-type', 'json');
        res.send({ "data": recordSet, "max": 0 });
        return next();
      });
    });
  });

  server.post('/:tableName', (req, res, next) => {
    dbKey = req.header("x-apidb-dbkey");
    tblName = req.params['tableName'];
    if (tblName == null || tblName.length <= 0) {
      return next(
        new server.errors.ForbiddenError("Missing Table Name")
      );
    }

    __.getDataConnection(dbKey, function (dataConnection) {
      if (!dataConnection) {
        return next(
          new server.errors.ForbiddenError("APIKEY Not Registered")
        );
      }

      sortBy = false;
      columns = null;
      filter = null;
      if (req.body['orderby'] != null && req.body['orderby'].length > 0) sortBy = req.body['orderby'];
      if (req.body['columns'] != null && req.body['columns'].length > 0) columns = req.body['columns'].split(",");

      try {
        if (req.body['filter'] != null && req.body['filter'].length > 0) filter = JSON.parse(req.body['filter']);
      } catch (e) {

      }
      // console.log(typeof filter,filter);


      dataConnection.listData({
        "dbkey": dbKey,
        "table": tblName,
        "columns": columns,
        "orderby": sortBy,
        "filter": filter
      }, function (recordSet) {
        res.header('content-type', 'json');
        res.send({ "data": recordSet, "max": 0 });
        return next();
      });
    });
  });

  server.get('/:tableName/:idHash', (req, res, next) => {
    dbKey = req.header("x-apidb-dbkey");
    tblName = req.params['tableName'];
    idHash = req.params['idHash'];

    if (tblName == null || tblName.length <= 0) {
      return next(
        new server.errors.ForbiddenError("Missing Table Name")
      );
    }
    if (idHash == null || idHash.length <= 0) {
      return next(
        new server.errors.ForbiddenError("Missing Identifier Name")
      );
    }

    __.getDataConnection(dbKey, function (dataConnection) {
      if (!dataConnection) {
        return next(
          new server.errors.ForbiddenError("APIKEY Not Registered")
        );
      }

      columns = null;
      if (req.query['columns'] != null && req.query['columns'].length > 0) columns = req.query['columns'].split(",");

      dataConnection.fetchData({
        "dbkey": dbKey,
        "table": tblName,
        "columns": columns,
        "idhash": idHash
      }, function (recordDetails) {
        res.header('content-type', 'json');
        res.send({ "data": recordDetails });
        return next();
      });
    });
  });

  server.get('/:tableName/schema', (req, res, next) => {
    dbKey = req.header("x-apidb-dbkey");
    tblName = req.params['tableName'];
    if (tblName == null || tblName.length <= 0) {
      return next(
        new server.errors.ForbiddenError("Missing Table Name")
      );
    }

    __.getDataConnection(dbKey, function (dataConnection) {
      if (!dataConnection) {
        return next(
          new server.errors.ForbiddenError("APIKEY Not Registered")
        );
      }

      rebuild = req.params['rebuild'];
      if (rebuild == null) rebuild = false;

      dataConnection.getSchema({
        "dbkey": dbKey,
        "table": tblName,
        "rebuild": rebuild
      }, function (schema) {
        console.log('MYSQL getSchema for table', tblName, ':-', schema);
        model = {};
        _.each(schema.paths, function (a, b) {
          // model[b] = {
          //   "type": a.instance,
          //   "validator": a.validators,
          //   // "index": a._index
          // };
          model[b] = { ...a, type: a.instance };
          delete model[b].instance;
        });

        res.header('content-type', 'json');
        res.send({ "model": model });

        return next();
      });
    });
  });

  server.post('/:tableName/create', (req, res, next) => {
    dbKey = req.header("x-apidb-dbkey");
    tblName = req.params['tableName'];
    if (tblName == null || tblName.length <= 0) {
      return next(
        new server.errors.ForbiddenError("Missing Table Name")
      );
    }

    __.getDataConnection(dbKey, function (dataConnection) {
      if (!dataConnection) {
        return next(
          new server.errors.ForbiddenError("APIKEY Not Registered")
        );
      }

      recordData = req.body;
      recordData[CONFIG.DB_SPECIAL_COLUMNS.CREATED_ON] = moment().format("YYYY-MM-DD HH:mm:ss");

      if (dbKey === 'apidbkey1') {
        recordData[CONFIG.DB_SPECIAL_COLUMNS.UPDATED_ON] = recordData[CONFIG.DB_SPECIAL_COLUMNS.CREATED_ON];
        recordData[CONFIG.DB_SPECIAL_COLUMNS.SOFT_DELETE] = "false";
      }

      dataConnection.insertData({
        "dbkey": dbKey,
        "table": tblName
      }, recordData, function (ans) {
        if (!ans || ans[0]._id == null) {
          res.header('content-type', 'json');
          res.send({ "status": false, "data": 0 });
        } else {
          res.header('content-type', 'json');
          res.send({ "status": true, "data": ["Success", ans[1]] || [] });
        }

        return next();
      });
    });
  });

  server.put('/:tableName/:idHash', (req, res, next) => {
    dbKey = req.header("x-apidb-dbkey");
    tblName = req.params['tableName'];
    idHash = req.params['idHash'];

    if (tblName == null || tblName.length <= 0) {
      return next(
        new server.errors.ForbiddenError("Missing Table Name")
      );
    }
    if (idHash == null || idHash.length <= 0) {
      return next(
        new server.errors.ForbiddenError("Missing Identifier Name")
      );
    }

    __.getDataConnection(dbKey, function (dataConnection) {
      if (!dataConnection) {
        return next(
          new server.errors.ForbiddenError("APIKEY Not Registered")
        );
      }
      recordData = req.body;
      if (dbKey === 'apidbkey1') {
        recordData[CONFIG.DB_SPECIAL_COLUMNS.UPDATED_ON] = moment().format("YYYY-MM-DD HH:mm:ss");
      }

      dataConnection.updateData({
        "dbkey": dbKey,
        "table": tblName,
        "idhash": idHash
      }, recordData,
        function (ans) {
          // if (ans._id == null) {
          //   res.header('content-type', 'json');
          //   res.send({ "status": false });
          // } else if(ans.affectedRows == null){
          //   res.header('content-type', 'json');
          //   res.send({ "status": false, "msg": "Record not found" });
          // }else {
          //   res.header('content-type', 'json');
          //   res.send({ "status": true });
          // }
          if (dbKey === 'apidbkey1' || dbKey === 'apidbkey3') {
            if (!ans._id) {
              res.header('content-type', 'json');
              res.send({ status: false });
            } else {
              res.header('content-type', 'json');
              res.send({ status: true , data: [ans, ans[1]] || []});
            }
          } else if (dbKey === 'apidbkey2') {
            if (ans.affectedRows == null || ans.affectedRows === 0) {
              res.header('content-type', 'json');
              res.send({ status: false, msg: "Record not found" });
            } else {
              res.header('content-type', 'json');
              res.send({ status: true });
            }
          } else if(dbKey ===  'apidbkey4'){
            if(ans.result.rowsAffected == null || ans.result.rowsAffected[0] === 0){
              res.header('content-type', 'json');
              res.send({ status: false, msg: "Record not found" });
            } else {
              res.header('content-type', 'json');
              res.send({ status: true , exe_time:  ans.duration.exe_time || [] });
            }
          }
          return next();
        });
    });
  });

  server.del('/:tableName/:idHash', (req, res, next) => {
    dbKey = req.header("x-apidb-dbkey");
    tblName = req.params['tableName'];
    idHash = req.params['idHash'];

    if (tblName == null || tblName.length <= 0) {
      return next(
        new server.errors.ForbiddenError("Missing Table Name")
      );
    }
    if (idHash == null || idHash.length <= 0) {
      return next(
        new server.errors.ForbiddenError("Missing Identifier Name")
      );
    }

    __.getDataConnection(dbKey, function (dataConnection) {
      if (!dataConnection) {
        return next(
          new server.errors.ForbiddenError("APIKEY Not Registered")
        );
      }

      purge = req.params['purge'];
      if (purge == "true") {
        dataConnection.deleteData({
          "dbkey": dbKey,
          "table": tblName,
          "idhash": idHash
        }, function (ans) {
          console.log("Delete Response:", ans);
          // if (ans._id == null) {
          //   res.header('content-type', 'json');
          //   res.send({ "status": false });
          // } else {
          //   res.header('content-type', 'json');
          //   res.send({ "status": true });
          // }
          res.header('content-type', 'json');
          res.send({ "status": true , "data": [ans, ans[1]] || []});
          return next();
        });
      } else {
        recordData = {};
        if (dbKey === 'apidbkey1') {
          recordData[CONFIG.DB_SPECIAL_COLUMNS.DELETED_ON] = moment().format("YYYY-MM-DD HH:mm:ss");
          recordData[CONFIG.DB_SPECIAL_COLUMNS.SOFT_DELETE] = "true";
        } else if (dbKey === 'apidbkey3' || dbKey === 'apidbkey2' || dbKey === 'apidbkey4') {
          recordData[CONFIG.DB_SPECIAL_COLUMNS.IS_ACTIVE] = "false";
        }
        recordData[CONFIG.DB_SPECIAL_COLUMNS.UPDATED_ON] = moment().format("YYYY-MM-DD HH:mm:ss");
        dataConnection.updateData({
          "dbkey": dbKey,
          "table": tblName,
          "idhash": idHash
        }, recordData, function (ans) {
          if (ans == null || ans._id == null) {
            res.header('content-type', 'json');
            res.send({ "status": false, "msg": "Record not found" });
          } else {
            res.header('content-type', 'json');
            res.send({ "status": true , "data": [ans, ans[1]] || []});
          }
          return next();
        });
      }
    });
  });

  // Add this route to your server routes file
  server.post('/multi-join', (req, res, next) => {
    dbKey = req.header("x-apidb-dbkey");
    const body = req.body || {};
    console.log('multi-join body:', body);


    if (!body.tables && body.table) {
      body.tables = [body.table];
    }
    if (!body.columns && body.column) {
      body.columns = Array.isArray(body.column) ? body.column : [body.column];
    }

    if (!dbKey) {
      return next(new server.errors.ForbiddenError("Missing API DB key"));
    }
    if (!body.tables || !Array.isArray(body.tables) || body.tables.length === 0) {
      return next(new server.errors.ForbiddenError("Missing 'tables' array in request body"));
    }

    __.getDataConnection(dbKey, function (dataConnection) {
      if (!dataConnection) {
        return next(new server.errors.ForbiddenError("APIKEY Not Registered"));
      }

      dataConnection.generateSQLQuery({
        dbkey: dbKey,
        tables: body.tables,
        joins: body.joins || [],
        columns: body.columns || [],
        rawColumns: body.rawColumns || [],
        where: body.where || [],
        orderBy: body.orderBy,
        limit: body.limit,
        offset: body.offset
      }, function (result) {
        res.header('content-type', 'application/json');

        // If fetchJoinedData returns a structured error, forward it
        if (result && result.status === 'error' || result === false) {
          // return 400 with the error message
          res.statusCode = 400;
          res.send({ status: 'error', msg: result?.msg ? result.msg : result });
          return next();
        }

        // success -> rows (array)
        res.send({ status: 'ok', data: result });
        return next();
      });
    });
  });

  server.del('/:tableName', (req, res, next) =>{
    dbKey = req.header("x-apidb-dbkey");
    tblName = req.params['tableName'];
    if(tblName == null || tblName.length == 0){
      return next(
        new server.errors.ForbiddenError("Missing Table Name")
      );
    }

    __.getDataConnection(dbKey, function(dataConnection){
      if(!dataConnection){
        return next(
          new server.errors.ForbiddenError("API Key is not registered")
        );
      }
      if (req.params['collection'] == "delete") {
        dataConnection.deleteCollection({
          "dbkey": dbKey,
          "table": tblName
        }, function (ans) {
          console.log("Collection Delete Response:", ans);
          if (ans == null || ans.length == 0 || ans.error) {
            if (ans && ans.error) {
              console.log("Error deleting collection:", ans.error);
              res.header('content-type', 'json');
              res.send({ "status": false, "data": ans.error });
            } else {
              res.header('content-type', 'json');
              res.send({ "status": false, "msg": "Collection not found or could not be deleted" });
            }
          } else {
            res.header('content-type', 'json');
            res.send({ "status": true, "data": ans[1] || [] });
          }
          return next();
        });
      }else if(req.params['collection'] == "truncate"){
        dataConnection.resetCollection({
          "dbkey": dbKey,
          "table": tblName
        }, function (ans) {
          console.log("Collection truncate Response:", ans);
          if (ans == null || ans.length == 0 || ans.error) {
            if (ans && ans.error) {
              console.log("Error truncate collection:", ans.error);
              res.header('content-type', 'json');
              res.send({ "status": false, "data": ans.error });
            } else {
              res.header('content-type', 'json');
              res.send({ "status": false, "msg": "Collection not found or could not be truncate" });
            }
          } else {
            res.header('content-type', 'json');
            res.send({ "status": true, "data": ans || [] });
          }
          return next();
        });
      }else{
        res.header('content-type', 'json');
        res.send({ "status": false, "msg": "Invalid action. Use /delete or /truncate" });
        return next();
      }
      
    })
  })
}