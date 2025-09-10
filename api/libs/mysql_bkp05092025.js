//MYSQL/MariaDB Database Driver

var mysql = require("mysql");

module.exports =    class  {
    DBPROPS = null;
    DBKEY = null;
    DBCON = null;

    DRIVER_NAME = "MYSQL";

    constructor(dbKey, dbProps) {
        this.DBPROPS = dbProps;
        this.DBKEY = dbKey;
    }

    connect (callback) {
        const that = this;
        // console.log("Connection", this.DBKEY, this.DBPROPS);
        var connection = mysql.createConnection(this.DBPROPS.CONNECTION_STRING);

        connection.connect(function (err) {
            if (err) {
                callback(false, err.message);
                return;
            }
            that.DBCON = connection;

            //console.log('connected as id ' + connection.threadId, that.DBKEY);
            callback(true);
        });
    }

    disconnect(callback) {that
        if (this.DBCON != null) this.DBCON.end();
        callback(true);
    }

    getQuery(sqlObj) {
        return generateSQLQuery(sqlObj);
    }

    runQuery(sqlObj, callback) {
        if (this.DBCON == null) {
            callback("Connection Not Found");
            return;
        }

        // console.log(
        //     "MYSQL_RUN_QUERY",
        //     this.DBKEY,
        //     this.DBPROPS.DATABASE,
        //     sqlObj
        // );

        var sqlQuery = generateSQLQuery(sqlObj);
        var whereParams = {};

        if (process.env.LOG_QUERY) {
            console.log(`${this.DRIVER_NAME}-QUERY`, sqlQuery, whereParams);
        } else if (process.env.DEBUG) {
            console.log(`${this.DRIVER_NAME}-QUERY`, sqlQuery, whereParams);
        }

        this.DBCON.query(
            sqlQuery,
            whereParams,
            function (err, results, fields) {
                if (err) {
                    if (err) console.log(err);
                    callback(err.message);
                    return;
                }

                if (results.length <= 0) {
                    callback(false, { data: [], query: sqlQuery });
                    return;
                }

                results = JSON.parse(JSON.stringify(results));
                callback(false, {
                    data: results,
                    query: sqlQuery,
                });
            }
        );
    }

    runQueryRAW(sqlQuery, whereParams, callback) {
        if (this.DBCON == null) {
            callback("Connection Not Found");
            return;
        }

        if (process.env.LOG_QUERY) {
            console.log(`${this.DRIVER_NAME}-QUERY`, sqlQuery, whereParams);
        } else if (process.env.DEBUG) {
            console.log(`${this.DRIVER_NAME}-QUERY`, sqlQuery, whereParams);
        }

        this.DBCON.query(
            sqlQuery,
            whereParams,
            function (err, results, fields) {
                if (err) {
                    if (err) console.log(err);
                    callback(false);
                    return;
                }

                if (results.length <= 0) {
                    callback(false, { data: [], query: sqlQuery });
                    return;
                }

                results = JSON.parse(JSON.stringify(results));
                callback(false, {
                    data: results,
                    query: sqlQuery,
                });
            }
        );
    }

    tableList(callback) {
        this.DBCON.query("SHOW TABLES", {}, function (err, results, fields) {
            // console.log(err,results,fields);
            if (err) {
                callback(true, err.message);
                return;
            }
            if (results.length <= 0) {
                return callback(false, []);
            }
            results = results.map((v) => Object.assign({}, v));

            var tableList = [];
            _.each(results, (a) => {
                tableList.push(a[fields[0].name]);
            });

            callback(false, tableList);
        });
    }

    tableSchema(tableName, callback) {
        var tableSchema = {};
        var dbName = this.DBPROPS.DATABASE;

        this.DBCON.query(
            //`SELECT * FROM information_schema.tables WHERE  information_schema.tables.table_schema='${dbName}'`,
            `DESCRIBE ${tableName}`,
            {},
            function (err, results, fields) {
                if (err) {
                    callback(true, err.message);
                    return;
                }

                if (results.length > 0) {
                    _.each(results, (a) => {
                        var row = Object.values(a);
                        // console.log(row);

                        tableSchema[row[0]] = {
                            name: row[0],
                            title: toTitle(row[0]),
                            shortTitle: row[0],
                            native_type: row[1],
                            type: row[1].substr(0, row[1].indexOf("(")),
                            aggType: "number", //varchar,number,datetime
                            default: row[4],
                            possible_values: false,
                            index_type: false,
                        };
                    });
                }

                callback(false, tableSchema);
            }
        );
    }
};

//Sample Query
function generateSQLQuery(sqlObj) {
    if (process.env.DEBUG) console.log(`MYSQL-sqlObj`, sqlObj);

    var columnsStr = "*";
    var limit = 1000;
    var offset = 0;
    var groupby = false;
    var orderby = false;
    var having = false;

    // columns
    if (Array.isArray(sqlObj.column)) {
        columnsStr = sqlObj.column
            .map((a) => {
                return processTilde(a);
            })
            .join(", ");
    } else if (sqlObj.column) {
        columnsStr = processTilde(sqlObj.column);
    }

    if (sqlObj.limit) {
        limit = sqlObj.limit;
    }
    if (sqlObj.offset) {
        offset = sqlObj.offset;
    }

    if (sqlObj.orderby) {
        orderby = sqlObj.orderby;
    }

    if (sqlObj.groupby) {
        groupby = sqlObj.groupby;
    }

    if (sqlObj.having) {
        having = sqlObj.having;
    }

    if (!limit || limit == null || (typeof limit === 'string' && limit.length <= 0)) {
        limit = process.env.MAX_RECORDS;
    }

    var sql = `SELECT ${columnsStr} FROM ${sqlObj.table} `;

    // ----------------------
    // JOIN handling
    // sqlObj.joins can be:
    //  - an array of objects: [{type:'LEFT', table:'tbl_project_members pm', on:'p.id = pm.project_id'}, ...]
    //  - an array of strings: ["LEFT JOIN tbl_project_members pm ON p.id = pm.project_id", ...]
    //  - a single object or string
    // ----------------------
    if (sqlObj.joins) {
        var joinsArr = [];
        if (Array.isArray(sqlObj.joins)) {
            joinsArr = sqlObj.joins;
        } else {
            // object or string
            joinsArr = [sqlObj.joins];
        }

        joinsArr.forEach(function (j) {
            if (!j) return;

            if (typeof j === 'string') {
                // raw join string (allow but be careful with injection)
                sql += ' ' + processTilde(j) + ' ';
            } else if (typeof j === 'object') {
                // expected fields: type, table, on
                var typ = (j.type || 'INNER').toString().trim().toUpperCase();
                if (typ !== 'INNER' && typ !== 'LEFT' && typ !== 'RIGHT' && typ !== 'CROSS' && typ !== 'FULL') {
                    // fallback to INNER for any unexpected type
                    typ = 'INNER';
                }
                var tbl = j.table ? processTilde(j.table) : false;
                var on = j.on ? processTilde(j.on) : false;
                if (tbl && on) {
                    sql += ` ${typ} JOIN ${tbl} ON ${on} `;
                } else if (tbl && j.condition) {
                    // alternative property name 'condition'
                    sql += ` ${typ} JOIN ${tbl} ON ${processTilde(j.condition)} `;
                }
            }
        });
    }

    var WHERE_ADDED = false;

    // normalize where: if string, keep as-is (after processTilde), else convert map
    if (typeof sqlObj.where == "string") {
        sqlObj.where = processTilde(sqlObj.where);
    } else if (sqlObj.where && typeof sqlObj.where === 'object') {
        var temp = {};
        _.each(sqlObj.where, function (k, v) {
            temp[processTilde(v)] = processTilde(k);
        });
        sqlObj.where = temp;
    }

    var sqlWhere = processSQLWhere(sqlObj.where, " ");
    console.log("sqlWhere", sqlWhere);
    if (sqlWhere && sqlWhere.length > 0) {
        sqlWhere = sqlWhere.replace(/``/g, "`");
        sql += " WHERE " + sqlWhere;
        WHERE_ADDED = true;
    }

    // filters (additional where clauses)
    if (typeof sqlObj.filter == "string") {
        sqlObj.filter = processTilde(sqlObj.filter);
    } else if (sqlObj.filter && typeof sqlObj.filter === 'object') {
        var tempf = {};
        _.each(sqlObj.filter, function (k, v) {
            tempf[processTilde(v)] = processTilde(k);
        });
        sqlObj.filter = tempf;
    }

    var sqlWhere2 = processSQLWhere(sqlObj.filter, " ");
    if (sqlWhere2 && sqlWhere2.length > 0) {
        sqlWhere2 = sqlWhere2.replace(/``/g, "`");
        if (WHERE_ADDED) sql += " AND " + sqlWhere2;
        else sql += " WHERE " + sqlWhere2;

        WHERE_ADDED = true;
    }

    // group by / having
    if (groupby && groupby.length > 0) {
        groupby = processTilde(groupby);
        sql += ` GROUP BY ${groupby}`;
    }
    if (having && having.length > 0) {
        having = processTilde(having);
        sql += ` HAVING ${having}`;
    }

    // order by
    if (orderby && orderby.length > 0) {
        var direction = "DESC";
        if (orderby.indexOf(" DESC") > 0) {
            orderby = orderby.replace(" DESC", "");
        } else if (orderby.indexOf(" ASC") > 0) {
            direction = "ASC";
            orderby = orderby.replace(" ASC", "");
        } else if (orderby.indexOf(" desc") > 0) {
            orderby = orderby.replace(" desc", "");
        } else if (orderby.indexOf(" asc") > 0) {
            direction = "ASC";
            orderby = orderby.replace(" asc", "");
        }

        orderby = processTilde(orderby);
        sql += ` ORDER BY ${orderby} ${direction}`;
    }

    // limit
    if (limit != null && limit > 0) {
        if (offset == null) {
            offset = 0;
        }
        sql += ` LIMIT ${offset}, ${limit}`;
    }

    // cleanup duplicate single-quotes
    sql = sql.replaceAll(/('')+/g, "'");
    sql = sql.replaceAll(/('')+/g, "'");

    return sql;
}
// function generateSQLQuery(sqlObj) {
//     if (process.env.DEBUG) console.log(`MYSQL-sqlObj`, sqlObj);

//     var columnsStr = "*";
//     var limit = 1000;
//     var offset = 0;
//     var groupby = false;
//     var orderby = false;
//     var having = false;

//     if (Array.isArray(sqlObj.column)) {
//         columnsStr = sqlObj.column
//             .map((a) => {
//                 return processTilde(a);
//             })
//             .join(", ");
//     }
//     else {
//         columnsStr = processTilde(sqlObj.column);
//     }

//     if (sqlObj.limit) {
//         limit = sqlObj.limit;
//     }
//     if (sqlObj.offset) {
//         offset = sqlObj.offset;
//     }

//     if (sqlObj.orderby) {
//         orderby = sqlObj.orderby;
//     }

//     if (sqlObj.groupby) {
//         groupby = sqlObj.groupby;
//     }

//     if (sqlObj.having) {
//         having = sqlObj.having;
//     }

//     if (!limit || limit == null || limit.length <= 0) {
//         limit = process.env.MAX_RECORDS;
//     }

//     var sql = `SELECT ${columnsStr} FROM ${sqlObj.table} `;

//     //Handle sqlObj.join
//     //Handle sqlObj.table_connection

//     var WHERE_ADDED = false;

//     if(typeof sqlObj.where == "string") {
//         sqlObj.where = processTilde(sqlObj.where);
//     } else {
//         var temp = {};
//         _.each(sqlObj.where, function(k,v) {
//             temp[processTilde(v)] = processTilde(k);
//         });
//         sqlObj.where = temp;
//     }

//     var sqlWhere = processSQLWhere(sqlObj.where, " ");
//     console.log("sqlWhere", sqlWhere);
//     if (sqlWhere.length > 0) {
//         sqlWhere = sqlWhere.replace(/``/g, "`");
//         sql += " WHERE " + sqlWhere;
//         WHERE_ADDED = true;
//     }

//     if(typeof sqlObj.filter == "string") {
//         sqlObj.filter = processTilde(sqlObj.filter);
//     } else {
//         var temp = {};
//         _.each(sqlObj.filter, function(k,v) {
//             temp[processTilde(v)] = processTilde(k);
//         });
//         sqlObj.filter = temp;
//     }

//     var sqlWhere = processSQLWhere(sqlObj.filter, " ");
//     if (sqlWhere.length > 0) {
//         sqlWhere = sqlWhere.replace(/``/g, "`");
//         if (WHERE_ADDED) sql += " AND " + sqlWhere;
//         else sql += " WHERE " + sqlWhere;

//         WHERE_ADDED = true;
//     }

//     // if(is_array(sqlObj.obj['groupby'])) {
//     //     if(isset(sqlObj.obj['groupby']['group'])) {
//     //         group=sqlObj.obj['groupby']['group'];
//     //     }
//     //     if(isset(sqlObj.obj['groupby']['having'])) {
//     //         having=sqlObj.obj['groupby']['having'];
//     //     }
//     // }

//     if (groupby && groupby.length > 0) {
//         groupby = processTilde(groupby);
//         sql += ` GROUP BY ${groupby}`;
//     }
//     if (having && having.length > 0) {
//         having = processTilde(having);
//         sql += ` HAVING ${having}`;
//     }

//     if (orderby && orderby.length > 0) {
//         var direction = "DESC";
//         if (orderby.indexOf(" DESC") > 0) {
//             orderby = orderby.replace(" DESC", "");
//         } else if (orderby.indexOf(" ASC") > 0) {
//             direction = "ASC";
//             orderby = orderby.replace(" ASC", "");
//         } else if (orderby.indexOf(" desc") > 0) {
//             orderby = orderby.replace(" desc", "");
//         } else if (orderby.indexOf(" asc") > 0) {
//             direction = "ASC";
//             orderby = orderby.replace(" asc", "");
//         }

//         orderby = processTilde(orderby);
//         sql += ` ORDER BY ${orderby} ${direction}`;
//     }

//     if (limit != null && limit > 0) {
//         if (offset == null) {
//             offset = 0;
//         }
//         sql += ` LIMIT ${offset}, ${limit}`;
//     }

//     sql = sql.replaceAll(/('')+/g,"'");
//     sql = sql.replaceAll(/('')+/g,"'");

//     return sql;
// }

function processTilde(str) {
    if (str == null || typeof str != "string") return str;
    var a1 = str;
    var k1 = 0;
    // while(a1.indexOf("`")>=0) {
    //     // console.log(k1, a1);
    //     if(k1%2==0)
    //         a1 = a1.replace("`", "[");
    //     else
    //         a1 = a1.replace("`", "]");
    //     k1++;
    // }
    const regex = /( as )[a-zA-Z0-9_-]+/gm;
    a1 = a1.replace(regex, function (k, v) {
        var t = k.replace(" as ", "").trim();
        return ` as '${t}'`;
    })
    // console.log(">", a1);
    return a1;
};