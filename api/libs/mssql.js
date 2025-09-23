const sql = require('mssql');
const TIME = require('../helpers/formatduration');

/**
 * MSSQL API functions (similar logic/format as mysql.js)
 * Requires: npm i mssql
 */

const logger = global.logger || console;

module.exports = {
    poolMap: {},

    connect: function (params, callback) {
        if (!params) {
            logger.error('MSSQL.connect called without params');
            return callback(false);
        }
        const key = params.dbkey || (params.database ? params.database : (params.server + ':' + params.port));
        if (this.poolMap[key]) {
            return callback(this._wrap(this.poolMap[key], params));
        }
        
        const config = {
            server: params.server || params.host || '127.0.0.1',
            port: params.port ? parseInt(params.port, 10) : 1433,
            user: params.user || params.username || 'sa',
            password: params.pwd || params.password || '',
            database: params.database || '',
            options: {
                encrypt: false,
                trustServerCertificate: true
            },
            pool: {
                max: 10,
                min: 0,
                idleTimeoutMillis: 30000
            }
        };
        logger.info(`MSSQL.connect -> server=${config.server} port=${config.port} db=${config.database} user=${config.user}`);
        const pool = new sql.ConnectionPool(config);
        pool.connect().then(() => {
            this.poolMap[key] = pool;
            callback(this._wrap(pool, params));
        }).catch(err => {
            logger.error('MSSQL.connect error:', err && err.message ? err.message : err);
            try { pool.close(); } catch (e) { }
            callback(false);
        });
    },

    disconnect: function (params, callback) {
        const key = params.dbkey || (params.database ? params.database : (params.server + ':' + params.port));
        const pool = this.poolMap[key];
        if (pool) {
            pool.close().then(() => {
                delete this.poolMap[key];
                if (callback) callback(true);
            }).catch(err => {
                logger.error('MSSQL.disconnect error', err);
                if (callback) callback(false);
            });
        } else {
            if (callback) callback(false);
        }
    },

    processTilde: function (str) {
        if (str == null || typeof str != "string") return str;
        // MSSQL uses [] for identifiers, but keep logic similar
        const regex = /( as )[a-zA-Z0-9_-]+/gm;
        return str.replace(regex, function (k, v) {
            var t = k.replace(" as ", "").trim();
            return ` as '${t}'`;
        });
    },

    processSQLWhere: function (whereObj, joiner = ' AND ') {
        if (!whereObj) return "";
        if (typeof whereObj === 'string') return whereObj;
        function escId(col) {
            if (typeof col !== 'string') return col;
            return col.split('.').map(s => `[${s.replace(/[\[\]]/g, '')}]`).join('.');
        }
        function escValue(val) {
            if (val === null) return 'NULL';
            if (typeof val === 'number') return val;
            return `'${String(val).replace(/'/g, "''")}'`;
        }
        function build(node) {
            if (!node) return '';
            if (typeof node === 'string') return node;
            if (Array.isArray(node)) {
                return '(' + node.map(build).filter(Boolean).join(' OR ') + ')';
            }
            if (node.$or && Array.isArray(node.$or)) {
                return '(' + node.$or.map(build).filter(Boolean).join(' OR ') + ')';
            }
            if (node.$and && Array.isArray(node.$and)) {
                return '(' + node.$and.map(build).filter(Boolean).join(' AND ') + ')';
            }
            const parts = [];
            Object.keys(node).forEach(key => {
                const val = node[key];
                if (key === '$raw' && typeof val === 'string') {
                    parts.push(val);
                    return;
                }
                const col = escId(key);
                if (val && typeof val === 'object' && !Array.isArray(val)) {
                    if ('$eq' in val) parts.push(`${col} = ${escValue(val.$eq)}`);
                    if ('$ne' in val) parts.push(`${col} <> ${escValue(val.$ne)}`);
                    if ('$gt' in val) parts.push(`${col} > ${escValue(val.$gt)}`);
                    if ('$gte' in val) parts.push(`${col} >= ${escValue(val.$gte)}`);
                    if ('$lt' in val) parts.push(`${col} < ${escValue(val.$lt)}`);
                    if ('$lte' in val) parts.push(`${col} <= ${escValue(val.$lte)}`);
                    if ('$like' in val) parts.push(`${col} LIKE ${escValue(val.$like)}`);
                    if ('$in' in val) {
                        const arr = Array.isArray(val.$in) ? val.$in : (('' + val.$in).split(','));
                        parts.push(`${col} IN (${arr.map(x => escValue(x)).join(',')})`);
                    }
                    if ('$nin' in val) {
                        const arr = Array.isArray(val.$nin) ? val.$nin : (('' + val.$nin).split(','));
                        parts.push(`${col} NOT IN (${arr.map(x => escValue(x)).join(',')})`);
                    }
                    if ('$between' in val && Array.isArray(val.$between) && val.$between.length >= 2) {
                        parts.push(`${col} BETWEEN ${escValue(val.$between[0])} AND ${escValue(val.$between[1])}`);
                    }
                    if ('$is' in val) {
                        if (val.$is === null) parts.push(`${col} IS NULL`);
                        else parts.push(`${col} IS ${val.$is}`);
                    }
                } else if (Array.isArray(val)) {
                    parts.push(`${col} IN (${val.map(x => escValue(x)).join(',')})`);
                } else if (val === null) {
                    parts.push(`${col} IS NULL`);
                } else {
                    parts.push(`${col} = ${escValue(val)}`);
                }
            });
            return parts.join(' AND ');
        }
        const out = build(whereObj);
        return out ? out : "";
    },

    _wrap: function (pool, params) {
        return {
            listTables: function (callback) {
                const startNs = process.hrtime.bigint();
                pool.request().query("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'", function (err, result) {
                    const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
                    if (err) {
                        logger.error('MSSQL listTables error', err && err.message ? err.message : err);
                        return callback([]);
                    }
                    const rows = result.recordset || [];
                    const tables = [{ total: rows.length, data: rows.map(r => r.TABLE_NAME) }, TIME.executionTime(durationMs)];
                    callback(tables);
                });
            },

            listData: function (params, callback) {
                if (!params || !params.table) return callback([]);
                const table = params.table;
                let cols = '*';
                if (params.columns && Array.isArray(params.columns) && params.columns.length > 0) {
                    cols = params.columns.map(c => `[${c}]`).join(', ');
                }
                let where = '';
                const values = [];
                if (params.filter && typeof params.filter === 'object') {
                    const parts = [];
                    Object.keys(params.filter).forEach(k => {
                        const v = params.filter[k];
                        if (v && typeof v === 'object' && v.$eq !== undefined) {
                            parts.push(`[${k}] = @${k}`);
                            values.push({ name: k, value: v.$eq });
                        } else if (v && typeof v === 'object' && v.$in !== undefined) {
                            const inArr = Array.isArray(v.$in) ? v.$in : (('' + v.$in).split(','));
                            parts.push(`[${k}] IN (${inArr.map((_, i) => `@${k}_in${i}`).join(',')})`);
                            inArr.forEach((val, i) => values.push({ name: `${k}_in${i}`, value: val }));
                        } else if (v && typeof v === 'object' && v.$ne !== undefined) {
                            parts.push(`[${k}] <> @${k}`);
                            values.push({ name: k, value: v.$ne });
                        } else {
                            parts.push(`[${k}] = @${k}`);
                            values.push({ name: k, value: v });
                        }
                    });
                    if (parts.length) where = ' WHERE ' + parts.join(' AND ');
                }
                let sqlStr = `SELECT ${cols} FROM [${table}]${where}`;
                if (params.orderby) {
                    sqlStr += ' ORDER BY ' + params.orderby;
                }
                sqlStr += ' OFFSET 0 ROWS FETCH NEXT 1000 ROWS ONLY';
                logger.info('MSSQL query: ', sqlStr, 'MSSQL listData :', values);
                const startNs = process.hrtime.bigint();
                const req = pool.request();
                values.forEach(v => req.input(v.name, v.value));
                req.query(sqlStr, function (err, result) {
                    const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
                    logger.info(`MSSQL listData for table ${table} took ${durationMs.toFixed(2)} ms`);
                    if (err) {
                        logger.error('MSSQL listData query error for table', table, err && err.message ? err.message : err);
                        return callback([]);
                    }
                    const rows = result.recordset || [];
                    const data = [{ total: rows.length, data: rows }, TIME.executionTime(durationMs)];
                    callback(data);
                });
            },

            insertData: function (params, recordData, callback) {
                if (!params || !params.table) return callback(false);
                const table = params.table;
                const BATCH_LIMIT = (global.BATCH_LIMIT && Number(global.BATCH_LIMIT)) || 100;
                const isArray = Array.isArray(recordData);
                const records = isArray ? recordData : [recordData];
                if (!records || records.length === 0) return callback(false);
                const startNs = process.hrtime.bigint();
                const keySet = new Set();
                records.forEach(rec => {
                    if (rec && typeof rec === 'object') {
                        Object.keys(rec).forEach(k => keySet.add(k));
                    }
                });
                const keys = Array.from(keySet);
                if (keys.length === 0) return callback(false);
                const normalizeRecord = (rec) => {
                    return keys.map(k => {
                        let v = rec && Object.prototype.hasOwnProperty.call(rec, k) ? rec[k] : null;
                        if (v === undefined) v = null;
                        if (v !== null && typeof v === 'object') {
                            try {
                                return JSON.stringify(v);
                            } catch (e) {
                                return String(v);
                            }
                        }
                        return v;
                    });
                };
                const allInsertedIds = [];
                let errorOccured = false;
                const processBatch = function (offset) {
                    if (errorOccured) return callback(false);
                    if (offset >= records.length) {
                        const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
                        logger.info(`MSSQL insertData (bulk) took ${durationMs.toFixed(2)} ms`);
                        const data = [{ _id: isArray ? allInsertedIds : (allInsertedIds[0] || null) }, TIME.executionTime(durationMs)];
                        return callback(data);
                    }
                    const batch = records.slice(offset, offset + BATCH_LIMIT);
                    const emailKeyPresent = keys.indexOf('email') !== -1;
                    if (emailKeyPresent) {
                        const emails = [];
                        batch.forEach((r) => {
                            const e = r && Object.prototype.hasOwnProperty.call(r, 'email') ? r.email : null;
                            if (e !== undefined && e !== null && String(e).trim() !== '') {
                                emails.push(String(e).trim());
                            }
                        });
                        if (emails.length === 0) {
                            return performInsert(batch, offset);
                        }
                        const placeholders = emails.map((_, i) => `@email${i}`).join(',');
                        const checkSql = `SELECT [email] FROM [${table}] WHERE [email] IN (${placeholders})`;
                        const req = pool.request();
                        emails.forEach((e, i) => req.input(`email${i}`, e));
                        req.query(checkSql, function (errCheck, result) {
                            if (errCheck) {
                                const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
                                logger.error('MSSQL insertData email-check error', errCheck && errCheck.message ? errCheck.message : errCheck, checkSql);
                                logger.info(`MSSQL insertData failed after ${durationMs.toFixed(2)} ms`);
                                errorOccured = true;
                                return callback(false);
                            }
                            const rows = result.recordset || [];
                            const existingEmails = new Set(rows.map(r => r.email));
                            const filteredBatch = batch.filter(r => {
                                const e = r && Object.prototype.hasOwnProperty.call(r, 'email') ? r.email : null;
                                if (e === undefined || e === null || String(e).trim() === '') {
                                    return true;
                                }
                                return !existingEmails.has(String(e));
                            });
                            const skippedCount = batch.length - filteredBatch.length;
                            if (skippedCount > 0) {
                                logger.info(`MSSQL insertData: skipped ${skippedCount} rows due to duplicate email(s) in table '${table}'`);
                            }
                            if (filteredBatch.length === 0) {
                                return processBatch(offset + BATCH_LIMIT);
                            }
                            return performInsert(filteredBatch, offset + BATCH_LIMIT - batch.length);
                        });
                    } else {
                        return performInsert(batch, offset + BATCH_LIMIT);
                    }
                };
                const performInsert = function (rowsToInsert, nextOffset) {
                    const columnsStr = keys.map(k => `[${k}]`).join(', ');
                    const valuesStr = rowsToInsert.map((_, i) => `(${keys.map((k, j) => `@${k}_${i}`).join(', ')})`).join(', ');
                    const sqlStr = `INSERT INTO [${table}] (${columnsStr}) VALUES ${valuesStr}; SELECT SCOPE_IDENTITY() AS insertId;`;
                    const req = pool.request();
                    rowsToInsert.forEach((r, i) => {
                        const normalized = normalizeRecord(r);
                        normalized.forEach((v, j) => req.input(`${keys[j]}_${i}`, v));
                    });
                    req.query(sqlStr, function (err, result) {
                        if (err) {
                            const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
                            logger.error('MSSQL insertData batch error', err && err.message ? err.message : err, sqlStr);
                            logger.info(`MSSQL insertData failed after ${durationMs.toFixed(2)} ms`);
                            errorOccured = true;
                            return callback(false);
                        }
                        // MSSQL doesn't return all inserted IDs for bulk insert, so just push nulls
                        for (let i = 0; i < rowsToInsert.length; i++) allInsertedIds.push(null);
                        processBatch(nextOffset);
                    });
                };
                processBatch(0);
            },

            fetchData: function (params, callback) {
                if (!params || !params.table) return callback(false);
                const table = params.table;
                const id = params.idhash || params.id;
                if (!id) return callback(false);
                const startNs = process.hrtime.bigint();
                logger.info('MSSQL fetchData for table', table, 'id:', id);
                const req = pool.request();
                req.input('id', id);
                req.query(`SELECT TOP 1 * FROM [${table}] WHERE [id] = @id`, function (err, result) {
                    const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
                    logger.info(`MSSQL fetchData for table ${table} id=${id} took ${durationMs.toFixed(2)} ms`);
                    if (err) {
                        logger.error('MSSQL fetchData error', err && err.message ? err.message : err);
                        return callback(false);
                    }
                    const rows = result.recordset || [];
                    if (!rows || rows.length === 0) return callback(false);
                    const data = [{ total: rows.length, data: rows[0] }, TIME.executionTime(durationMs)];
                    callback(data);
                });
            },

            updateData: function (params, recordData, callback) {
                if (!params || !params.table || !params.idhash) return callback(false);
                const table = params.table;
                const id = params.idhash;
                const rec = {};
                Object.keys(recordData).forEach(k => {
                    const v = recordData[k];
                    if (v === undefined) return;
                    if (typeof v === 'object') rec[k] = JSON.stringify(v);
                    else rec[k] = v;
                });
                const sets = Object.keys(rec).map(k => `[${k}] = @${k}`).join(', ');
                const req = pool.request();
                Object.keys(rec).forEach(k => req.input(k, rec[k]));
                req.input('id', id);
                const sqlStr = `UPDATE [${table}] SET ${sets} WHERE [id] = @id`;
                req.query(sqlStr, function (err, result) {
                    if (err) {
                        logger.error('MSSQL updateData error', err && err.message ? err.message : err);
                        return callback(false);
                    }
                    callback(result);
                });
            },

            deleteData: function (params, callback) {
                if (!params || !params.table || !params.idhash) return callback(false);
                const table = params.table;
                const id = params.idhash;
                const req = pool.request();
                req.input('id', id);
                req.query(`DELETE FROM [${table}] WHERE [id] = @id`, function (err, result) {
                    if (err) {
                        logger.error('MSSQL deleteData error', err && err.message ? err.message : err);
                        return callback(false);
                    }
                    callback(result);
                });
            },

            getSchema: function (params, callback) {
                if (!params || !params.table) return callback(false);
                const table = params.table;
                const sqlStr = `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_DEFAULT, IS_NULLABLE
                                FROM INFORMATION_SCHEMA.COLUMNS
                                WHERE TABLE_NAME = @table
                                ORDER BY ORDINAL_POSITION`;
                const startNs = process.hrtime.bigint();
                const req = pool.request();
                req.input('table', table);
                req.query(sqlStr, function (err, result) {
                    const durationMS = Number(process.hrtime.bigint() - startNs) / 1e6;
                    if (err) {
                        logger.error('MSSQL getSchema error', err && err.message ? err.message : err);
                        return callback(false);
                    }
                    const rows = result.recordset || [];
                    let paths = {};
                    rows.forEach(col => {
                        paths[col.COLUMN_NAME] = {
                            instance: col.DATA_TYPE.toUpperCase(),
                            validators: [],
                            default: col.COLUMN_DEFAULT,
                            nullable: col.IS_NULLABLE,
                            comment: ''
                        };
                    });
                    paths.duration = TIME.executionTime(durationMS);
                    callback({ paths });
                });
            },

            generateSQLQuery: function (sqlObj, callback) {
                if (process.env.DEBUG) console.log(`MSSQL-sqlObj`, sqlObj);
                const processTilde = (typeof this.processTilde === 'function')
                    ? this.processTilde.bind(this)
                    : (typeof module.exports.processTilde === 'function'
                        ? module.exports.processTilde.bind(module.exports)
                        : (s => s));
                const processSQLWhere = (typeof this.processSQLWhere === 'function')
                    ? this.processSQLWhere.bind(this)
                    : (typeof module.exports.processSQLWhere === 'function'
                        ? module.exports.processSQLWhere.bind(module.exports)
                        : (w => ""));
                var columnsStr = "*";
                var limit = 1000;
                var offset = 0;
                var groupby = false;
                var orderby = false;
                var having = false;
                if (Array.isArray(sqlObj.columns)) {
                    columnsStr = sqlObj.columns.map((a) => processTilde(a)).join(", ");
                } else if (sqlObj.columns) {
                    columnsStr = processTilde(sqlObj.columns);
                }
                if (sqlObj.limit) limit = sqlObj.limit;
                if (sqlObj.offset) offset = sqlObj.offset;
                if (sqlObj.orderby) orderby = sqlObj.orderby;
                if (sqlObj.groupby) groupby = sqlObj.groupby;
                if (sqlObj.having) having = sqlObj.having;
                if (!limit || limit == null || (typeof limit === 'string' && limit.length <= 0)) {
                    limit = process.env.MAX_RECORDS;
                }
                var sqlStr = `SELECT ${columnsStr} FROM ${sqlObj.tables} `;
                if (sqlObj.joins) {
                    var joinsArr = Array.isArray(sqlObj.joins) ? sqlObj.joins : [sqlObj.joins];
                    joinsArr.forEach(function (j) {
                        if (!j) return;
                        if (typeof j === 'string') {
                            sqlStr += ' ' + processTilde(j) + ' ';
                        } else if (typeof j === 'object') {
                            var typ = (j.type || 'INNER').toString().trim().toUpperCase();
                            if (typ !== 'INNER' && typ !== 'LEFT' && typ !== 'RIGHT' && typ !== 'CROSS' && typ !== 'FULL') {
                                typ = 'INNER';
                            }
                            var tbl = j.table ? processTilde(j.table) : false;
                            var on = j.on ? processTilde(j.on) : false;
                            if (tbl && on) {
                                sqlStr += ` ${typ} JOIN ${tbl} ON ${on} `;
                            } else if (tbl && j.condition) {
                                sqlStr += ` ${typ} JOIN ${tbl} ON ${processTilde(j.condition)} `;
                            }
                        }
                    });
                }
                var WHERE_ADDED = false;
                if (typeof sqlObj.where == "string") {
                    sqlObj.where = processTilde(sqlObj.where);
                } else if (sqlObj.where && typeof sqlObj.where === 'object') {
                    var temp = {};
                    Object.keys(sqlObj.where).forEach(v => {
                        temp[processTilde(v)] = processTilde(sqlObj.where[v]);
                    });
                    sqlObj.where = temp;
                }
                var sqlWhere = processSQLWhere(sqlObj.where, " ");
                if (process.env.DEBUG) console.log("sqlWhere", sqlWhere);
                if (sqlWhere && sqlWhere.length > 0) {
                    sqlStr += " WHERE " + sqlWhere;
                    WHERE_ADDED = true;
                }
                if (typeof sqlObj.filter == "string") {
                    sqlObj.filter = processTilde(sqlObj.filter);
                } else if (sqlObj.filter && typeof sqlObj.filter === 'object') {
                    var tempf = {};
                    Object.keys(sqlObj.filter).forEach(v => {
                        tempf[processTilde(v)] = processTilde(sqlObj.filter[v]);
                    });
                    sqlObj.filter = tempf;
                }
                var sqlWhere2 = processSQLWhere(sqlObj.filter, " ");
                if (sqlWhere2 && sqlWhere2.length > 0) {
                    if (WHERE_ADDED) sqlStr += " AND " + sqlWhere2;
                    else sqlStr += " WHERE " + sqlWhere2;
                    WHERE_ADDED = true;
                }
                if (groupby && groupby.length > 0) {
                    groupby = processTilde(groupby);
                    sqlStr += ` GROUP BY ${groupby}`;
                }
                if (having && having.length > 0) {
                    having = processTilde(having);
                    sqlStr += ` HAVING ${having}`;
                }
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
                    sqlStr += ` ORDER BY ${orderby} ${direction}`;
                }
                if (limit != null && limit > 0) {
                    if (offset == null) offset = 0;
                    sqlStr += ` OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;
                }
                console.log("MSSQL-generateSQLQuery", sqlStr);
                const startNs = process.hrtime.bigint();
                pool.request().query(sqlStr, function (err, result) {
                    const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
                    if (err) {
                        console.error("MSSQL-generateSQLQuery error", err && err.message ? err.message : err);
                        return callback({ status: 'error', msg: err.message || 'Database error' });
                    }
                    const rows = result.recordset || [];
                    if (!rows || rows.length === 0) {
                        return callback([]);
                    }
                    const data = [{ Total: rows.length, data: rows }, TIME.executionTime(durationMs)];
                    return callback(data);
                });
            },

            deleteTable: function (params, callBack) {
                if (!params || !params.table) {
                    return callBack({ error: "Table name is required." });
                }
                const table = params.table;
                if (!/^[A-Za-z0-9_]+$/.test(table)) {
                    return callBack({ error: "Invalid table name." });
                }
                const checkSql = "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = @table";
                const req = pool.request();
                req.input('table', table);
                req.query(checkSql, function (err, result) {
                    if (err) {
                        logger.error("MSSQL deleteTable check error", err);
                        return callBack({ error: "Error checking table existence." });
                    }
                    const rows = result.recordset || [];
                    if (!rows || rows.length === 0) {
                        return callBack({ error: `Table '${table}' does not exist.` });
                    }
                    const startNs = process.hrtime.bigint();
                    const sqlStr = `DROP TABLE [${table}]`;
                    pool.request().query(sqlStr, function (err2, result2) {
                        const durationMS = Number(process.hrtime.bigint() - startNs) / 1e6;
                        logger.info(`MSSQL deleteTable took ${durationMS.toFixed(2)} ms`);
                        if (!err2) {
                            const data = [result2 || null, TIME.executionTime(durationMS)];
                            callBack(data);
                        } else {
                            logger.error("MSSQL deleteTable error", err2);
                            callBack({ error: "Failed to drop table." });
                        }
                    });
                });
            },

            resetCollection: function (params, callBack) {
                if (!params || !params.table) {
                    callBack(false);
                    return;
                }
                const table = params.table;
                if (!/^[A-Za-z0-9_]+$/.test(table)) {
                    return callBack({ error: "Invalid table name." });
                }
                const checkSql = "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = @table";
                const req = pool.request();
                req.input('table', table);
                req.query(checkSql, function (err, result) {
                    if (err) {
                        logger.error("MSSQL resetTable check error", err);
                        return callBack(false);
                    }
                    const rows = result.recordset || [];
                    if (!rows || rows.length === 0) {
                        return callBack({ error: `Table '${table}' does not exist.` });
                    }
                    const startNs = process.hrtime.bigint();
                    const deleteSql = `DELETE FROM [${table}]`;
                    pool.request().query(deleteSql, function (err2, deleteResult) {
                        if (err2) {
                            logger.error("MSSQL resetTable delete error", err2);
                            return callBack(false);
                        }
                        // Reset identity (auto increment) for MSSQL
                        const alterSql = `DBCC CHECKIDENT ('${table}', RESEED, 0)`;
                        pool.request().query(alterSql, function (err3) {
                            const durationMS = Number(process.hrtime.bigint() - startNs) / 1e6;
                            logger.info(`MSSQL resetTable took ${durationMS.toFixed(2)} ms`);
                            if (err3) {
                                logger.warn("MSSQL resetTable identity reset failed", err3);
                            }
                            const deletedCount = deleteResult && typeof deleteResult.rowsAffected === 'object'
                                ? deleteResult.rowsAffected[0] : 0;
                            const data = [{ deletedCount: deletedCount }, TIME.executionTime(durationMS)];
                            callBack(data);
                        });
                    });
                });
            }
        };
    }
};