/*
 * Data Connection Manager
 * 
 * */

const { bindKey } = require('lodash');
const MONGO = require('./libs/mongo');
const MYSQL = require('./libs/mysql');
const POSTGREYS = require('./libs/postgreysql');
const MSSQL = require('./libs/mssql');
// CONST REDIS = require("./libs/redis");

module.exports = {
    CONNECTIONPOOL: {},

    getDataConnection: function (dbKey, callback) {
        console.log("Get Data Connection for", dbKey);
        if (CONNECTPARAMS[dbKey] === null) {
            return false;
        }
        // Defensive checks
        // if (typeof CONNECTPARAMS === 'undefined') {
        //     const msg = "CONNECTPARAMS is not defined (global).";
        //     console.error(msg);
        //     return callback(new Error(msg));
        // }

        dataConnection = __.CONNECTIONPOOL[dbKey];
        console.log("Data Connection Found", dataConnection);
        if (dataConnection == null) {
            // console.log("Db Source: ", CONNECTPARAMS[dbKey].driver);
            switch (CONNECTPARAMS[dbKey]?.driver ?? "mysql") {
                case "mongo":
                    MONGO.connect(CONNECTPARAMS[dbKey], function (con) {
                        __.CONNECTIONPOOL[dbKey] = con;
                        callback(con);
                    });
                    break;
                case "mysql":
                    MYSQL.connect(CONNECTPARAMS[dbKey], function (con) {
                        console.log("MySQL Connection Established", con);
                        __.CONNECTIONPOOL[dbKey] = con;
                        callback(con);
                    });
                    break;
                case "postgres":
                    POSTGREYS.connect(CONNECTPARAMS[dbKey], function (con){
                        console.log("PostgreySQL Connection Established", con);
                        __.CONNECTIONPOOL[dbKey] = con;
                        callback(con);
                    });
                    break;
                case "mssql":
                    MSSQL.connect(CONNECTPARAMS[dbKey], function(con){
                        console.log("MSSQL Connection Established", con);
                        __.CONNECTIONPOOL[dbKey] = con;
                        callback(con);
                    });
                    break;
                case "sqlite3":

                    break;
                case "redis":

                    break;
                default:
                    return false;
            }

        } else {
            callback(dataConnection);
        }
    },

    getConnectionLength: function () {
        return Object.keys(this.CONNECTIONPOOL).length;
    }
}