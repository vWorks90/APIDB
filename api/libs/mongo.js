/*
 * Mongo Driver
 * 
 * */

//?? collection delete function and collection reset function
mongoose = require('mongoose');
validator = require('validator')
const { mongo } = require('mongoose');
const TIME = require('../helpers/formatduration'); 
// const mongo_helper = require('../helpers/mongo_helper')
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
            // check extra params%-
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
            this.mongooseDB = that.mongooseDB;

            callBack(that);
        });
    },

    disconnect: function (callBack) {
        this.mongooseDB.close();
        callBack(true);
    },

    //Helper Functions Start
    getModelKey: function (params) {
        return md5(params.dbkey + params.table);
    },

    saveModelSchema: function (params) {
        that = this;
        modelKey = this.getModelKey(params);

        dataSchema = this.dataSchema[modelKey];

        modelData = {};
        _.each(dataSchema.paths, function (a, b) {
            // if(["_id","__v"].indexOf(b)>=0) return;
            modelData[b] = {
                "type": a.instance,
                "validator": a.validators,
                // "index": a._index
            };
        });
        _CACHE.storeData(params.dbkey + ":MONGOSCHEMA:" + modelKey, modelData);
    },
    

    getModel: function (params, callBack) {
        that = this;
        modelKey = this.getModelKey(params);
        if (this.dataModels[modelKey] == null) {
            _CACHE.fetchData(params.dbkey + ":MONGOSCHEMA:" + modelKey, function (modelSchema) {
                if (modelSchema) {
                    delete modelSchema._id;
                    delete modelSchema.__v;
                    that.dataSchema[modelKey] = new Schema(modelSchema, { collection: params.table });
                } else {
                    that.dataSchema[modelKey] = new Schema({}, { collection: params.table });
                    that.saveModelSchema(params);
                }
                that.dataModels[modelKey] = that.mongooseDB.model(modelKey, that.dataSchema[modelKey]);

                that.newSchema.push(modelKey);

                callBack(that.dataModels[modelKey]);
            }, false);
        } else {
            callBack(that.dataModels[modelKey]);
        }
    },
    getProcessedModel: function (params, recordData, callBack) {
        if (params == null) return false;

        that = this;
        modelKey = this.getModelKey(params);
        const startNs = process.hrtime.bigint();
        this.getModel(params, function (dataModel) {
            if (Array.isArray(recordData)) {
                demoData = recordData[0];
            } else {
                demoData = recordData;
            }
            if (demoData) {
                if (demoData._doc != null) {
                    demoData = demoData._doc;

                    if (params.columns == null) {
                        params.columns = Object.keys(demoData);
                    }

                    if (params.columns != null && params.columns.length > 0) {
                        newCols = {};
                        _.each(params.columns, function (a, b) {
                            if (that.dataSchema[modelKey].path(a) == null) {
                                typeStr = "" + (typeof demoData[a]);
                                // console.log(a, demoData[a], typeof demoData[a], typeStr);
                                switch (typeStr) {
                                    case "number":
                                        newCols[a] = mongoose.Schema.Types.Number;
                                        break;
                                    case "string":
                                        newCols[a] = mongoose.Schema.Types.String;
                                        break;
                                    case "boolean":
                                        newCols[a] = mongoose.Schema.Types.Boolean;
                                        break;
                                    case "object":
                                        //Check Date
                                        newCols[a] = mongoose.Schema.Types.Date;
                                        break;
                                    default:
                                        newCols[a] = mongoose.Schema.Types.String;
                                }
                            }
                        });

                        if (Object.keys(newCols).length > 0) {
                            that.dataSchema[modelKey].add(newCols);
                            // console.log("UPDATED SCHEMA");

                            that.saveModelSchema(params);

                            if (that.newSchema.indexOf(modelKey) >= 0) {
                                delete that.newSchema[modelKey];
                            }
                        }
                    }
                } else {
                    if (params.columns == null) {
                        params.columns = Object.keys(demoData);
                    }

                    var regexDates = [
                        /^[0-9]{4}[\/\-][0-9]{2}[\/\-][0-9]{2}$/gmi,
                        /^[0-9]{4}[\/\-][0-9]{2}[\/\-][0-9]{2}[ ]{1}[0-9]{2}:[0-9]{2}$/gmi,
                        /^[0-9]{4}[\/\-][0-9]{2}[\/\-][0-9]{2}[ ]{1}[0-9]{2}:[0-9]{2}:[0-9]{2}$/gmi,
                        /^[0-9]{4}[\/\-][0-9]{2}[\/\-][0-9]{2}[ T]{1}[0-9]{2}:[0-9]{2}:[0-9]{2}$/gmi,
                    ]

                    if (params.columns != null && params.columns.length > 0) {
                        newCols = {};
                        _.each(params.columns, function (a, b) {
                            if (that.dataSchema[modelKey].path(a) == null) {
                                // console.log(a,demoData[a], typeof demoData[a]);
                                if (parseInt(demoData[a]) == demoData[a]) {
                                    newCols[a] = mongoose.Schema.Types.Number;
                                } else if (parseFloat(demoData[a]) == demoData[a]) {
                                    newCols[a] = mongoose.Schema.Types.Number;
                                } else if (demoData[a] == "true" || demoData[a] == "false") {
                                    newCols[a] = mongoose.Schema.Types.Boolean;
                                } else if (regexDates[0].test(demoData[a]) || regexDates[1].test(demoData[a]) || regexDates[2].test(demoData[a])) {
                                    newCols[a] = mongoose.Schema.Types.Date;
                                } else if (demoData[a].substring(0, 1) == "[" && demoData[a].substring(demoData[a].length - 1, demoData[a].length) == "]") {
                                    newCols[a] = mongoose.Schema.Types.String;
                                } else {
                                    // console.log(a, demoData[a], "NAN");
                                    newCols[a] = mongoose.Schema.Types.String;
                                }
                            }
                        });
                        if (Object.keys(newCols).length > 0) {
                            that.dataSchema[modelKey].add(newCols);
                            // console.log("UPDATED SCHEMA");

                            that.saveModelSchema(params);

                            if (that.newSchema.indexOf(modelKey) >= 0) {
                                delete that.newSchema[modelKey];
                            }
                        }
                    }
                }
            }
            callBack(dataModel);
        });
    },

    processFilter: function (filterData) {
        let finalFilter = {};

        if (filterData != null) {
            if (typeof filterData == "string") {
                try {
                    filterData = JSON.parse(filterData);
                } catch (e) {
                    // leave as-is if parsing fails
                }
            }

            _.each(filterData, function (value, key) {
                if (value == null) return;

                // If value is already an array, assume it is [val, OP] and leave it
                if (Array.isArray(value)) {
                    // fine — proceed to handler below
                } else if (typeof value === 'boolean' || typeof value === 'number') {
                    // booleans/numbers -> equality
                    value = [value, "EQ"];
                    filterData[key] = value;
                } else if (typeof value === 'object') {
                    // objects -> stringify and treat as EQ (keeps backward compatibility)
                    try {
                        value = [JSON.stringify(value), "EQ"];
                    } catch (e) {
                        value = [value, "EQ"];
                    }
                    filterData[key] = value;
                } else if (typeof value === 'string') {
                    // strings: preserve your existing prefix-based operators
                    const cmdStr = value.substring(0, 1);
                    switch (cmdStr) {
                        case "!":
                            value = [value.substring(1), "NE"];
                            break;
                        case "^":
                            value = [value.substring(1), "SW"];
                            break;
                        case "@":
                            value = [value.substring(1), "FIND"];
                            break;
                        case "#":
                            value = [value.substring(1), "LIKE"];
                            break;
                        default:
                            value = [value, "EQ"];
                    }
                    filterData[key] = value;
                    // check all query filter options
                } else {
                    // fallback for any other type
                    value = [value, "EQ"];
                    filterData[key] = value;
                }

                // Normalize operator to string
                const op = (value[1] || "EQ").toString().toLowerCase();

                // Helper local vars (avoid globals)
                let temp, finalArr;

                switch (op) {
                    // Equals
                    case "eq": case ":eq:": case "=":
                        finalFilter[key] = { "$eq": value[0] };
                        break;

                    case "ne": case ":ne:":
                    case "neq": case ":neq:":
                    case "<>":
                        finalFilter[key] = { "$ne": value[0] };
                        break;

                    // Less then, greater then
                    case "lt": case ":lt:":
                    case "<":
                        finalFilter[key] = { "$lt": value[0] };
                        break;
                    case "le": case ":le:": case "lte": case ":lte:":
                    case "<=":
                        finalFilter[key] = { "$lte": value[0] };
                        break;
                    case "gt": case ":gt:":
                    case ">":
                        finalFilter[key] = { "$gt": value[0] };
                        break;
                    case "ge": case ":ge:": case "gte": case ":gte:":
                    case ">=":
                        finalFilter[key] = { "$gte": value[0] };
                        break;

                    case "in": case ":in:":
                        if (Array.isArray(value[0])) finalFilter[key] = { "$in": value[0] };
                        else finalFilter[key] = { "$in": ('' + value[0]).split(",") };
                        break;
                    case "ni": case "nin": case ":ni:":
                        if (Array.isArray(value[0])) finalFilter[key] = { "$nin": value[0] };
                        else finalFilter[key] = { "$nin": ('' + value[0]).split(",") };
                        break;

                    // Not null
                    case "nn": case "null": case ":nn:":
                        finalFilter[key] = { "$exists": true };
                        break;
                    case "nu": case "notnull": case ":nu:":
                        finalFilter[key] = { "$exists": false };
                        break;
                    // FIND IN SET EQUIVALENT
                    case "s": case ":s:":
                    case "find": case ":find:":
                        temp = ('' + value[0]).split(",");
                        finalArr = [];
                        _.each(temp, function (a, b) {
                            finalArr.push(new RegExp(a + ","));
                            finalArr.push(new RegExp("," + a));
                        });
                        finalFilter[key] = { "$in": finalArr };
                        break;
                    case "ns": case ":ns:":
                    case "notfind": case ":notfind:":
                        temp = ('' + value[0]).split(",");
                        finalArr = [];
                        _.each(temp, function (a, b) {
                            finalArr.push(new RegExp(a + ",", 'gi'));
                            finalArr.push(new RegExp("," + a, 'gi'));
                        });
                        finalFilter[key] = { "$nin": finalArr };
                        break;
                    // Like / starts / ends
                    case "bw": case ":bw:":
                    case "sw": case ":sw:":
                    case "starts":
                        finalFilter[key] = { "$in": [new RegExp("^" + value[0], 'gi')] };
                        break;
                    case "bn": case ":bn:":
                    case "sn": case ":sn:":
                    case "notstarts":
                        finalFilter[key] = { "$nin": [new RegExp("^" + value[0], 'gi')] };
                        break;

                    case "lw": case ":lw:":
                    case "ew": case ":ew:":
                    case "ends":
                        finalFilter[key] = { "$in": [new RegExp(value[0] + "$", 'gim')] };
                        break;

                    case "ln": case ":ln:":
                    case "en": case ":en:":
                    case "notends":
                        finalFilter[key] = { "$nin": [new RegExp(value[0] + "$", 'gim')] };
                        break;

                    case "cw": case ":cw:":
                    case "between": case "like":
                        finalFilter[key] = { "$in": [new RegExp(value[0], 'gim')] };
                        break;

                    case "cn": case ":cn:":
                    case "notbetween": case "notlike":
                        finalFilter[key] = { "$nin": [new RegExp(value[0], 'gim')] };
                        break;

                    case "range":
                        temp = ('' + value[0]).split(",");
                        if (parseInt(temp[0]) == temp[0]) {
                            finalFilter[key] = {
                                "$gte": parseInt(temp[0]),
                                "$lte": parseInt(temp[1]),
                            };
                        } else if (parseFloat(temp[0]) == temp[0]) {
                            finalFilter[key] = {
                                "$gte": parseFloat(temp[0]),
                                "$lte": parseFloat(temp[1]),
                            };
                        } else {
                            finalFilter[key] = {
                                "$gte": temp[0],
                                "$lte": temp[1],
                            };
                        }
                        break;
                    case "rangestr":
                        temp = ('' + value[0]).split(",");
                        finalFilter[key] = {
                            "$gte": temp[0],
                            "$lte": temp[1],
                        };
                        break;
                    default:
                        console.log(key, value);
                }
            });
        }
        // console.log(JSON.stringify(finalFilter), "MONGO");
        return finalFilter;
    },
    //Helper Functions End

    getSchema: function (params, callBack) {
        that = this;
        modelKey = md5(params.dbkey + params.table);
        if (this.dataSchema[modelKey] == null || params.rebuild) {
            this.getModel(params, function (dataModel) {
                if (!dataModel) return callBack(false);
                dataModel.find({}).limit(1).exec(function (err, result) {
                    if (!err) {
                        this.getProcessedModel({
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
            const data =  [{ total: collectionList.length, data: collectionList.map(a => a.name) }, TIME.executionTime(durationMS)];
            // callBack(collectionList.map(a => a.name));
            callBack(data)
        });
    },

    listData: function (params, callBack) {
        // console.log(global.SKIP,global.LIMIT, params);
        that = this;
        dbKey = params.dbkey;
        dbTable = params.table;
        modelKey = this.getModelKey(params);

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
        this.getModel(params, function (dataModel) {
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
                const data = [{ total: (result) ? result.length : 0, data: result || [] }, TIME.executionTime(durationMS)];
                if (!err) {
                    if (that.newSchema.indexOf(modelKey) >= 0) {
                        this.getProcessedModel({
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
        this.getModel(params, function (dataModel) {
            if (!dataModel) return callBack([]);

            query = dataModel.findById(params.idhash, params.columns);
            const startNs = process.hrtime.bigint();
            query.exec(function (err, result) {
                const durationMS = Number(process.hrtime.bigint() - startNs) / 1e6;
                logger.info(`MONGO fetchData took ${durationMS.toFixed(2)} ms`);
                const data = [result || null, TIME.executionTime(durationMS)];
                if (!err) {
                    if (result == null) {
                        callBack(false);
                        return;
                    }
                    if (that.newSchema.indexOf(modelKey) >= 0) {
                        this.getProcessedModel(params, result, function (dataModel) {
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

    insertData: function (params, recordData, callBack) { // Bulk insert with batch limit
        const startNs = process.hrtime.bigint();
        const BATCH_LIMIT = 1000;
        const isArray = Array.isArray(recordData);
        const records = isArray ? recordData : [recordData];

        this.getProcessedModel(params, records, function (dataModel) {
            if (!dataModel) return callBack(false);

            // Helper to insert in batches
            const insertBatch = async () => {
                let results = [];
                let errorOccured = false;
                for (let i = 0; i < records.length; i += BATCH_LIMIT) {
                    const batch = records.slice(i, i + BATCH_LIMIT);
                    try {
                        // Use await for sequential batch insert
                        // If you want parallel, use Promise.all, but Mongo may throttle
                        // eslint-disable-next-line no-await-in-loop
                        const res = await dataModel.create(batch);
                        results = results.concat(res);
                    } catch (err) {
                        logger.error("MONGO insertData batch error", err);
                        errorOccured = true;
                        break;
                    }
                }
                const durationMS = Number(process.hrtime.bigint() - startNs) / 1e6;
                logger.info(`MONGO insertData (bulk) took ${durationMS.toFixed(2)} ms`);
                if (errorOccured) {
                    callBack(false);
                } else {
                    // Return all inserted docs if bulk, or single if not
                    const data = [{ _id: isArray ? results : results[0] }, TIME.executionTime(durationMS)];
                    callBack(data);
                }
            };

            // If only one record, insert directly
            if (records.length <= BATCH_LIMIT) {
                dataModel.create(records, function (err, result) {
                    const durationMS = Number(process.hrtime.bigint() - startNs) / 1e6;
                    logger.info(`MONGO insertData took ${durationMS.toFixed(2)} ms`);
                    if (!err) {
                        const data = [{ _id: isArray ? result : result[0] || null }, TIME.executionTime(durationMS)];
                        callBack(data);
                    } else {
                        logger.error("MONGO insertData error", err);
                        callBack(false);
                    }
                });
            } else {
                // Bulk insert in batches
                insertBatch();
            }
        });
    },

    updateData: function (params, recordData, callBack) {
        if (params.idhash == null) {
            callBack(false);
            return;
        }
        const startNs = process.hrtime.bigint();
        this.getProcessedModel(params, recordData, function (dataModel) {
            const durationMS = Number(process.hrtime.bigint() - startNs) / 1e6;
            logger.info(`MONGO updateData took ${durationMS.toFixed(2)} ms`);
            if (!dataModel) return callBack(false);

            dataModel.findByIdAndUpdate(params.idhash, recordData, { new: true }, function (err, result) {
                if (!err) {
                    // handle result
                    const data = [result || null, TIME.executionTime(durationMS)];
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
        this.getModel(params, function (dataModel) {
            if (!dataModel) return callBack(false);
            const durationMS = Number(process.hrtime.bigint() - startNs) / 1e6;
            logger.info(`MONGO deleteData took ${durationMS.toFixed(2)} ms`);
            dataModel.findByIdAndDelete(params.idhash, function (err, result) {
                if (!err) {
                    // handle result
                    const data = [result || null, TIME.executionTime(durationMS)];
                    callBack(data);
                } else {
                    // error handling
                    // console.log(err);
                    callBack(false);
                };
            });
        });
    },

    // Delete entire collection
    deleteCollection: function (params, callBack) {
        if (!params || !params.table) {
            return callBack({ error: "Table name is required." });
            
        }
        // Check if collection exists
        this.mongooseDB.db.listCollections({ name: params.table }).toArray((err, collections) => {
            if (err) {
                return callBack({ error: "Error checking collections." });
                
            }
            if (!collections || collections.length === 0) {
               return callBack({ error: `Collection '${params.table}' does not exist.` });
               
            }
            this.getModel(params, (dataModel) => {
                if (!dataModel) return callBack({ error: "Model not found." });
                const startNs = process.hrtime.bigint();
                dataModel.collection.drop((err, result) => {
                    const durationMS = Number(process.hrtime.bigint() - startNs) / 1e6;
                    logger.info(`MONGO deleteCollection took ${durationMS.toFixed(2)} ms`);
                    if (!err) {
                        const data = [result || null, TIME.executionTime(durationMS)];
                        callBack(data);
                    } else {
                        callBack({ error: "Failed to drop collection." });
                    }
                });
            });
        });
    },
   

    // Reset collection (delete all documents, keep collection)
    resetCollection: function (params, callBack) {
        if (!params || !params.table) {
            callBack(false);
            return;
        }
        this.getModel(params, (dataModel) => {
            if (!dataModel) return callBack(false);
            const startNs = process.hrtime.bigint();
            dataModel.deleteMany({}, (err, result) => {
                const durationMS = Number(process.hrtime.bigint() - startNs) / 1e6;
                logger.info(`MONGO resetCollection took ${durationMS.toFixed(2)} ms`);
                if (!err) {
                                            // const data = [result || null, TIME.executionTime(durationMS)];
                    const data = [{deletedCount: result?.deletedCount ? result.deletedCount : 0}, TIME.executionTime(durationMS)];
                    callBack(data);
                } else {
                    callBack(false);
                }
            });
        });
    },
};