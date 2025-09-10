/*
 * Mongo Driver
 * 
 * */

// create helper functions in /helpers/mongo_helper.js file
//?? collection delete function or collection reset function
mongoose = require('mongoose');
validator = require('validator')
const { mongo } = require('mongoose');
const TIME = require('../helpers/formatduration'); // spell formatduration 
const mongo_helper = require('../helpers/mongo_helper')
Schema = mongoose.Schema;

module.exports = {
    mongooseDB: null,
    dataModels: {},
    dataSchema: {},
    newSchema: [],

    connect: function (params, callBack) {
        if (params.options == null) {
            params.options = {
                "useNewUrlParser": true,
                "useFindAndModify": false
            };
            //?? check extra params
        }
        mongoose.connect(params.uri, params.options);
        that = this;
        this.mongooseDB = mongoose.connection;
        this.mongooseDB.on('error', function () {
            logger.error('MongoDB Connection Error');
            // process.exit(1);
            callBack(false);
        });
        this.mongooseDB.once('open', function () {
            logger.info("MongoDB Connected");
            callBack(that);
        });
    },

    disconnect: function (callBack) {
        this.mongooseDB.close();
        callBack(true);
    },

    getSchema: function (params, callBack) {
        that = this;
        modelKey = md5(params.dbkey + params.table);
        if (this.dataSchema[modelKey] == null || params.rebuild) {
            mongo_helper.getModel(params, function (dataModel) {
                if (!dataModel) return callBack(false);
                dataModel.find({}).limit(1).exec(function (err, result) {
                    if (!err) {
                        mongo_helper.getProcessedModel({
                            "dbkey": params.dbkey,
                            "table": params.table,
                        }, result, function (dataModel) {
                            callBack(that.dataSchema[modelKey]);
                        });
                    } else {
                        // error handling
                        callBack(false);
                    };
                });
            });

        } else {
            callBack(this.dataSchema[modelKey]);
        }
    },

    listTables: function (callBack) {
        const startNs = process.hrtime.bigint();
        this.mongooseDB.db.listCollections().toArray(function (err, collectionList) {
            const durationMS = Number(process.hrtime.bigint() - startNs) / 1e6;
            logger.info(`MONGO listTables took ${durationMS.toFixed(2)} ms`);
            if (collectionList == null) collectionList = [];
            const data =  [{ total: collectionList.length, data: collectionList.map(a => a.name) }, TIME.formatDurationMs(durationMS)];
            // callBack(collectionList.map(a => a.name));
            callBack(data)
        });
    },

    listData: function (params, callBack) {
        // console.log(global.SKIP,global.LIMIT, params);
        that = this;
        dbKey = params.dbkey;
        dbTable = params.table;
        modelKey = mongo_helper.getModelKey(params);

        if (this.dataSchema[modelKey] == null) {
            //help create schema
            params1 = _.extend({}, params, { "rebuild": true });
            this.getSchema(params1, function (ans) {
                if (ans) {
                    that.listData(params, callBack);
                } else {
                    callBack([]);
                }
            });
            return;
        }
        // always ensure filter exists
        // params.filter = params.filter || {};

        // // enforce blocked = false
        // params.filter.blocked = false;

        params.filter = mongo.processFilter(params.filter);
        mongo_helper.getModel(params, function (dataModel) {
            if (!dataModel) return callBack([]);

            query = dataModel.find(params.filter, params.columns, { skip: global.SKIP }).limit(global.LIMIT);

            if (params.orderby) {
                ob = {};
                orderBY = params.orderby.split(" ");
                if (orderBY.length > 1) {
                    ob[orderBY[0]] = (orderBY[1].toUpperCase() == "ASC") ? 1 : -1;
                } else {
                    ob[params.orderby] = -1;
                }
                query.sort(ob);
            }
            const startNs = process.hrtime.bigint();
            query.exec(function (err, result) {
                const durationMS = Number(process.hrtime.bigint() - startNs) / 1e6;
                logger.info(`MONGO listData took ${durationMS.toFixed(2)} ms`);
                const data = [{ total: (result) ? result.length : 0, data: result || [] }, TIME.formatDurationMs(durationMS)];
                if (!err) {
                    if (that.newSchema.indexOf(modelKey) >= 0) {
                        mongo_helper.getProcessedModel({
                            "dbkey": dbKey,
                            "table": dbTable,
                        }, result, function (dataModel) {
                            callBack(data);
                        });
                    } else {
                        callBack(data);
                    }
                } else {
                    // error handling
                    // console.log(err);
                    callBack([]);
                };
            });
        });
    },

    fetchData: function (params, callBack) {
        if (params.idhash == null) {
            callBack(false);
            return;
        }
        that = this;
        mongo_helper.getModel(params, function (dataModel) {
            if (!dataModel) return callBack([]);

            query = dataModel.findById(params.idhash, params.columns);
            const startNs = process.hrtime.bigint();
            query.exec(function (err, result) {
                const durationMS = Number(process.hrtime.bigint() - startNs) / 1e6;
                logger.info(`MONGO fetchData took ${durationMS.toFixed(2)} ms`);
                const data = [result || null, TIME.formatDurationMs(durationMS)];
                if (!err) {
                    if (result == null) {
                        callBack(false);
                        return;
                    }
                    if (that.newSchema.indexOf(modelKey) >= 0) {
                        mongo_helper.getProcessedModel(params, result, function (dataModel) {
                            callBack(data);
                        });
                    } else {
                        callBack(data);
                    }
                } else {
                    // error handling
                    console.log(err);
                    callBack([]);
                };
            });
        });
    },

    insertData: function (params, recordData, callBack) { //?? Bulk insert <with batch limit as per DB> Define in config.json
        const startNs = process.hrtime.bigint();    
        mongo_helper.getProcessedModel(params, recordData, function (dataModel) {
            const durationMS = Number(process.hrtime.bigint() - startNs) / 1e6;
            logger.info(`MONGO insertData took ${durationMS.toFixed(2)} ms`);
            if (!dataModel) return callBack(false);
            dataModel.create([recordData], function (err, result) {
                if (!err) {
                    // handle result
                    const data = [result[0] || null, TIME.formatDurationMs(durationMS)];
                    callBack(data);
                } else {
                    // error handling
                    console.log(err);
                    callBack(false);
                };
            });
        });
    },

    updateData: function (params, recordData, callBack) {
        if (params.idhash == null) {
            callBack(false);
            return;
        }
        const startNs = process.hrtime.bigint();
        mongo_helper.getProcessedModel(params, recordData, function (dataModel) {
            const durationMS = Number(process.hrtime.bigint() - startNs) / 1e6;
            logger.info(`MONGO updateData took ${durationMS.toFixed(2)} ms`);
            if (!dataModel) return callBack(false);

            dataModel.findByIdAndUpdate(params.idhash, recordData, { new: true }, function (err, result) {
                if (!err) {
                    // handle result
                    const data = [result || null, TIME.formatDurationMs(durationMS)];
                    callBack({_id: data});
                } else {
                    // error handling
                    // console.log(err);
                    callBack(false);
                };
            });
        });
    },
    
    deleteData: function (params, callBack) {
        if (params.idhash == null) {
            callBack(false);
            return;
        }
        const startNs = process.hrtime.bigint();
        mongo_helper.getModel(params, function (dataModel) {
            if (!dataModel) return callBack(false);
            const durationMS = Number(process.hrtime.bigint() - startNs) / 1e6;
            logger.info(`MONGO deleteData took ${durationMS.toFixed(2)} ms`);
            dataModel.findByIdAndDelete(params.idhash, function (err, result) {
                if (!err) {
                    // handle result
                    const data = [result || null, TIME.formatDurationMs(durationMS)];
                    callBack(data);
                } else {
                    // error handling
                    // console.log(err);
                    callBack(false);
                };
            });
        });
    },
};