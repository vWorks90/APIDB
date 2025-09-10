module.exports = {
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
                    //?? check all query filter options
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
}