// api/libs/mysql.js
// Requires: npm i mysql2

const mysql = require('mysql2');
const TIME = require('../helpers/formatduration');

module.exports = {
    poolMap: {},

    // connect(params, callback) -> callback(wrapper) OR callback(false)
    connect: function (params, callback) {
        // defensive
        if (!params) {
            logger.error('MYSQL.connect called without params');
            return callback(false);
        }

        // Build key for connection pool caching
        const key = params.dbkey || (params.database ? params.database : (params.host + ':' + params.port));

        // If pool exists, immediately return wrapper
        if (this.poolMap[key]) {
            return callback(this._wrap(this.poolMap[key], params));
        }

        // Check required fields
        const host = params.host || '127.0.0.1';
        const port = params.port ? parseInt(params.port, 10) : 3306;
        const user = params.user || params.username || 'root';
        const password = params.pwd || params.password || '';
        const database = params.database || '';

        logger.info(`MYSQL.connect -> host=${host} port=${port} db=${database} user=${user}`);

        // create pool
        const pool = mysql.createPool({
            host,
            port,
            user,
            password,
            database,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0
        });

        // simple ping test to ensure connectivity
        pool.getConnection((err, conn) => {
            if (err) {
                logger.error('MYSQL.connect error:', err && err.message ? err.message : err);
                // close pool if created
                try { pool.end(); } catch (e) { }
                return callback(false);
            }

            // release the connection and store pool
            conn.release();
            this.poolMap[key] = pool;

            // return wrapper (object with listData, insertData, listTables...)
            const wrapper = this._wrap(pool, params);
            return callback(wrapper);
        });
    },

    disconnect: function (params, callback) {
        const key = params.dbkey || (params.database ? params.database : (params.host + ':' + params.port));
        const pool = this.poolMap[key];
        if (pool) {
            pool.end(err => {
                if (err) logger.error('MYSQL.disconnect error', err);
                delete this.poolMap[key];
                if (callback) callback(true);
            });
        } else {
            if (callback) callback(false);
        }
    },

    processTilde: function (str) {
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
    },

    processSQLWhere: function (whereObj, joiner = ' AND ') {
        if (!whereObj) return "";
        if (typeof whereObj === 'string') return whereObj;

        // helper: escape identifiers like "p.id" -> `p`.`id`
        function escId(col) {
            if (typeof col !== 'string') return col;
            return col.split('.').map(s => `\`${s.replace(/`/g, '')}\``).join('.');
        }
        const escValue = mysql.escape.bind(mysql);

        function build(node) {
            if (!node) return '';
            if (typeof node === 'string') return node;
            if (Array.isArray(node)) {
                // default array -> treat as OR of nested clauses
                return '(' + node.map(build).filter(Boolean).join(' OR ') + ')';
            }
            // object
            // special logical operators
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
                    parts.push(val); // allow raw SQL if you trust source (use carefully)
                    return;
                }

                const col = escId(key);

                // object with operators
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
                        // e.g. {col: {$is: null}} or {$is: 'TRUE'}
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


    // Internal: produce wrapper with methods used by your app
    _wrap: function (pool, params) {
        return {
            // callback(callback) -> array of table names
            listTables: function (callback) {
                const startNs = process.hrtime.bigint();
                pool.query("SHOW TABLES", function (err, rows) {
                    const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
                    if (err) {
                        logger.error('MYSQL listTables error', err && err.message ? err.message : err);
                        return callback([]);
                    }
                    // convert rows to table names
                    const tables = [{total: rows.length, data: rows.map(r => Object.values(r)[0])},TIME.formatDurationMs(durationMs)];
                    callback(tables);
                });
            },

            // params.orderby - string "col ASC" or "col DESC"
            listData: function (params, callback) {
                if (!params || !params.table) return callback([]);

                const table = params.table;
                let cols = '*';
                if (params.columns && Array.isArray(params.columns) && params.columns.length > 0) {
                    cols = params.columns.map(c => `\`${c}\``).join(', ');
                }

                // build where clause from params.filter (basic support)
                let where = '';
                const values = [];
                if (params.filter && typeof params.filter === 'object') {
                    const parts = [];
                    Object.keys(params.filter).forEach(k => {
                        const v = params.filter[k];
                        if (v && typeof v === 'object' && v.$eq !== undefined) {
                            parts.push(`\`${k}\` = ?`);
                            values.push(v.$eq);
                        } else if (v && typeof v === 'object' && v.$in !== undefined) {
                            // v.$in -> array or comma string
                            const inArr = Array.isArray(v.$in) ? v.$in : (('' + v.$in).split(','));
                            parts.push(`\`${k}\` IN (${inArr.map(_ => '?').join(',')})`);
                            values.push(...inArr);
                        } else if (v && typeof v === 'object' && v.$ne !== undefined) {
                            parts.push(`\`${k}\` <> ?`);
                            values.push(v.$ne);
                        } else {
                            // fallback equality check
                            parts.push(`\`${k}\` = ?`);
                            values.push(v);
                        }
                    });
                    if (parts.length) where = ' WHERE ' + parts.join(' AND ');
                }

                let sql = `SELECT ${cols} FROM \`${table}\`${where}`;

                if (params.orderby) {
                    // caution: orderby comes from client; trust only simple formats
                    sql += ' ORDER BY ' + params.orderby;
                }

                // safety limit (can be tuned)
                sql += ' LIMIT 0, 1000'; //?? set limit in config.json
                logger.info('MYSQL query: ', sql, 'MYSQL listData :', values);
                const startNs = process.hrtime.bigint();
                pool.query(sql, values, function (err, rows) {
                    const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
                    logger.info(`MYSQL listData for table ${table} took ${durationMs.toFixed(2)} ms`);
                    if (err) {
                        logger.error('MYSQL listData query error for table', table, err && err.message ? err.message : err);
                        return callback([]);
                    }
                    const data = [{total: rows.length,data: rows || []}, TIME.formatDurationMs(durationMs)]; 
                    callback(data);
                });
            },

            // insertData(params, recordData, callback) -> callback([{ _id: insertId }]) or callback(false)
            insertData: function (params, recordData, callback) {//?? bulk insert refference in mongo.js
                if (!params || !params.table) return callback(false);
                const table = params.table;

                // sanitize data: convert objects/arrays to JSON strings
                const rec = {};
                Object.keys(recordData).forEach(k => {
                    const v = recordData[k];
                    if (v === undefined) return;
                    if (typeof v === 'object') rec[k] = JSON.stringify(v);
                    else rec[k] = v;
                });

                const keys = Object.keys(rec);
                if (keys.length === 0) return callback(false);

                const placeholders = keys.map(_ => '?').join(',');
                const sql = `INSERT INTO \`${table}\` (${keys.map(k => `\`${k}\``).join(',')}) VALUES (${placeholders})`;
                const vals = keys.map(k => rec[k]);
                const startNs = process.hrtime.bigint();
                pool.query(sql, vals, function (err, result) {
                    const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
                    if (err) {
                        logger.error('MYSQL insertData error', err && err.message ? err.message : err, sql);
                        return callback(false);
                    }
                    const data = [{_id: result.insertId}, TIME.formatDurationMs(durationMs)];
                    callback(data);
                });
            },

            // fetchData(params, callback) - expects params.idhash or id
            fetchData: function (params, callback) {
                if (!params || !params.table) return callback(false);
                const table = params.table;
                const id = params.idhash || params.id;
                if (!id) return callback(false);
                const startNs = process.hrtime.bigint();
                logger.info('MYSQL fetchData for table', table, 'id:', id);
                pool.query('SELECT * FROM ?? WHERE id = ? LIMIT 1', [table, id], function (err, rows) {
                    const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
                    logger.info(`MYSQL fetchData for table ${table} id=${id} took ${durationMs.toFixed(2)} ms`);
                    if (err) {
                        console.log('MYSQL fetchData error', err && err.message ? err.message : err);
                        return callback(false);
                    }
                    if (!rows || rows.length === 0) return callback(false);
                    const data = [{total: rows.length ,data: rows[0]}, TIME.formatDurationMs(durationMs)];
                    callback(data);
                });
            },

            // updateData(params, recordData, callback) - expects params.idhash
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

                const sets = Object.keys(rec).map(k => `\`${k}\` = ?`).join(',');
                const vals = Object.keys(rec).map(k => rec[k]);
                vals.push(id);

                const sql = `UPDATE \`${table}\` SET ${sets} WHERE id = ?`;
                pool.query(sql, vals, function (err, result) {
                    if (err) {
                        console.log('MYSQL updateData error', err && err.message ? err.message : err);
                        return callback(false);
                    }
                    callback(result);
                });
            },

            // deleteData(params, callback) - expects params.idhash
            deleteData: function (params, callback) {
                if (!params || !params.table || !params.idhash) return callback(false);
                const table = params.table;
                const id = params.idhash;
                pool.query('DELETE FROM ?? WHERE id = ?', [table, id], function (err, result) {
                    if (err) {
                        console.log('MYSQL deleteData error', err && err.message ? err.message : err);
                        return callback(false);
                    }
                    callback(result);
                });
            },

            // Inside _wrap(pool, params) in mysql.js
            getSchema: function (params, callback) {
                if (!params || !params.table) {
                    return callback(false);
                }
                const table = params.table;

                const sql = `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_DEFAULT, IS_NULLABLE, COLUMN_COMMENT
                             FROM INFORMATION_SCHEMA.COLUMNS
                             WHERE TABLE_SCHEMA = DATABASE()
                             AND TABLE_NAME = ?
                             ORDER BY ORDINAL_POSITION`;
                const startNs = process.hrtime.bigint();
                pool.query(sql, [table], function (err, rows) {
                    const durationMS = Number(process.hrtime.bigint() - startNs) / 1e6
                    if (err) {
                        logger.error('MYSQL getSchema error', err && err.message ? err.message : err);
                        return callback(false);
                    }
                    let paths = {};
                    rows.forEach(col => {
                        paths[col.COLUMN_NAME] = {
                            instance: col.DATA_TYPE.toUpperCase(),
                            validators: [], // no default validators in MySQL
                            default: col.COLUMN_DEFAULT,
                            nullable: col.IS_NULLABLE,
                            comment: col.COLUMN_COMMENT
                        }
                    });
                    paths.duration = TIME.formatDurationMs(durationMS);
                    callback({ paths });
                });
            },

            // fetchJoinedData: function (params, callback) {
            //     if (!params || !params.tables || !Array.isArray(params.tables) || params.tables.length === 0) {
            //         return callback({ status: 'error', msg: 'Missing tables array in request' });
            //     }

            //     const tables = params.tables;
            //     const joins = params.joins || [];
            //     const columns = params.columns || [];
            //     const rawColumns = params.rawColumns || [];
            //     const where = params.where || [];
            //     const orderBy = params.orderBy;
            //     const limit = Number.isFinite(params.limit) ? params.limit : null;
            //     const offset = Number.isFinite(params.offset) ? params.offset : null;

            //     function isSafeIdentifier(s) {
            //         return /^[A-Za-z0-9_]+$/.test(s);
            //     }
            //     function parseAliasCol(fragment) {
            //         const m = fragment.match(/^([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)(?:\s+as\s+([A-Za-z0-9_]+))?$/i);
            //         if (!m) return null;
            //         return { alias: m[1], col: m[2], asAlias: m[3] || null };
            //     }

            //     // Map alias -> tableName
            //     const aliasToTable = {};
            //     const tableNamesSet = new Set();

            //     for (let t of tables) {
            //         const alias = t.alias && isSafeIdentifier(t.alias) ? t.alias : t.name;
            //         aliasToTable[alias] = t.name;
            //         tableNamesSet.add(t.name);
            //     }
            //     for (let j of joins) {
            //         if (!j || !j.table || !j.table.name) continue;
            //         const alias = j.table.alias && isSafeIdentifier(j.table.alias) ? j.table.alias : j.table.name;
            //         aliasToTable[alias] = j.table.name;
            //         tableNamesSet.add(j.table.name);
            //     }

            //     const tableNames = Array.from(tableNamesSet);

            //     const placeholders = tableNames.map(() => '?').join(',');
            //     const schemaSql = `SELECT TABLE_NAME, COLUMN_NAME
            //            FROM INFORMATION_SCHEMA.COLUMNS
            //            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${placeholders})`;

            //     pool.query(schemaSql, tableNames, function (err, schemaRows) {
            //         if (err) {
            //             console.log('fetchJoinedData: schema query error', err.message);
            //             return callback({ status: 'error', msg: 'Failed to read database schema' });
            //         }

            //         const tableColumns = {};
            //         for (let r of schemaRows) {
            //             if (!tableColumns[r.TABLE_NAME]) tableColumns[r.TABLE_NAME] = new Set();
            //             tableColumns[r.TABLE_NAME].add(r.COLUMN_NAME);
            //         }

            //         const selectFragments = [];
            //         const sqlParams = [];

            //         if (columns.length > 0) {
            //             for (let c of columns) {
            //                 const parsed = parseAliasCol(c);
            //                 if (!parsed) return callback({ status: 'error', msg: `Invalid column format: ${c}` });

            //                 const tableName = aliasToTable[parsed.alias];
            //                 if (!tableName) return callback({ status: 'error', msg: `Unknown alias in column: ${parsed.alias}` });
            //                 if (!tableColumns[tableName].has(parsed.col)) {
            //                     return callback({ status: 'error', msg: `Column '${parsed.col}' not found in table '${tableName}'` });
            //                 }

            //                 // ✅ Use literal alias in SQL, identifiers only for table+col
            //                 if (parsed.asAlias) {
            //                     selectFragments.push(`${parsed.alias}.?? AS ??`);
            //                     sqlParams.push(parsed.col, parsed.asAlias);
            //                 } else {
            //                     selectFragments.push(`${parsed.alias}.??`);
            //                     sqlParams.push(parsed.col);
            //                 }
            //             }
            //         } else {
            //             const first = tables[0];
            //             selectFragments.push(`${first.alias || first.name}.*`);
            //         }

            //         // raw columns (no validation)
            //         if (rawColumns.length > 0) {
            //             selectFragments.push(...rawColumns);
            //         }

            //         // Build SQL
            //         let sql = 'SELECT ' + selectFragments.join(', ');

            //         // FROM
            //         const firstTable = tables[0];
            //         sql += ` FROM ?? AS ${firstTable.alias}`;
            //         sqlParams.push(firstTable.name);

            //         // JOINS
            //         for (let j of joins) {
            //             const type = (j.type || 'INNER').toUpperCase();
            //             sql += ` ${type} JOIN ?? AS ${j.table.alias} ON ${j.on.left} = ${j.on.right}`;
            //             sqlParams.push(j.table.name);
            //         }

            //         // WHERE
            //         if (where.length > 0) {
            //             const whereParts = [];
            //             for (let w of where) {
            //                 const [alias, col] = w.column.split('.');
            //                 const op = (w.operator || '=').toUpperCase();
            //                 if (op === 'IN') {
            //                     const qs = w.value.map(() => '?').join(',');
            //                     whereParts.push(`${alias}.?? IN (${qs})`);
            //                     sqlParams.push(col, ...w.value);
            //                 } else {
            //                     whereParts.push(`${alias}.?? ${op} ?`);
            //                     sqlParams.push(col, w.value);
            //                 }
            //             }
            //             sql += ' WHERE ' + whereParts.join(' AND ');
            //         }

            //         // ORDER
            //         if (orderBy) sql += ' ORDER BY ' + orderBy;

            //         // LIMIT/OFFSET
            //         if (limit !== null) {
            //             sql += ' LIMIT ?';
            //             sqlParams.push(limit);
            //             if (offset !== null) {
            //                 sql += ' OFFSET ?';
            //                 sqlParams.push(offset);
            //             }
            //         }

            //         console.log('MYSQL fetchJoinedData SQL:', sql, 'Params:', sqlParams);

            //         pool.query(sql, sqlParams, function (err, rows) {
            //             if (err) {
            //                 console.log('MYSQL fetchJoinedData error', err.message);
            //                 return callback({ status: 'error', msg: 'Database query error' });
            //             }
            //             return callback(rows || []);
            //         });
            //     });
            // },

            generateSQLQuery: function (sqlObj, callback) {
                // ensure debugging info
                if (process.env.DEBUG) console.log(`MYSQL-sqlObj`, sqlObj);
                // --- bind helpers (prefer wrapper methods if present, else fallback to module.exports) ---
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

                // ---------------------------------------------------------
                var columnsStr = "*";
                var limit = 1000;
                var offset = 0;
                var groupby = false;
                var orderby = false;
                var having = false;

                // columns
                if (Array.isArray(sqlObj.columns)) {
                    columnsStr = sqlObj.columns
                        .map((a) => {
                            return processTilde(a);
                        })
                        .join(", ");
                } else if (sqlObj.columns) {
                    columnsStr = processTilde(sqlObj.columns);
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

                var sql = `SELECT ${columnsStr} FROM ${sqlObj.tables} `;

                // ----------------------
                // JOIN handling
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
                if (process.env.DEBUG) console.log("sqlWhere", sqlWhere);
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

                // cleanup duplicate single-quotes (safe fallback for older Node)
                if (String.prototype.replaceAll) {
                    sql = sql.replaceAll(/('')+/g, "'");
                    sql = sql.replaceAll(/('')+/g, "'");
                } else {
                    sql = sql.replace(/('')+/g, "'");
                    sql = sql.replace(/('')+/g, "'");
                }
                console.log("MYSQL-generateSQLQuery", sql);

                // pool.query(sql, function (err, rows) {
                //     if(err){
                //         console.log("MYSQL-generateSQLQuery error", err && err.message ? err.message : err);    
                //     }
                //     if (!rows || rows.length === 0) {
                //         return callback(false);
                //     }
                //     return callback(rows[0]);
                // });
                const startNs = process.hrtime.bigint();
                pool.query(sql, function (err, rows) {
                    const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
                    if (err) {
                        console.error("MYSQL-generateSQLQuery error", err && err.message ? err.message : err);
                        // return structured error so callers can handle it
                        return callback({ status: 'error', msg: err.message || 'Database error' });
                    }

                    // Always return an array (empty array if no rows)
                    if (!rows || rows.length === 0) {
                        return callback([]);      // or callback({ status: 'ok', data: [] }) depending on your convention
                    }
                    const data = [{ Total: rows.length, data: rows }, TIME.formatDurationMs(durationMs)];

                    // Return full result array
                    return callback(data);
                });




            },





            //  generateSQLQuery: function (sqlObj) {
            //     console.log("MYSQL-generateSQLQuery", sqlObj);
            //     if (process.env.DEBUG) console.log(`MYSQL-sqlObj`, sqlObj);

            //     var columnsStr = "*";
            //     var limit = 1000;
            //     var offset = 0;
            //     var groupby = false;
            //     var orderby = false;
            //     var having = false;

            //     // columns
            //     if (Array.isArray(sqlObj.columns)) {
            //         columnsStr = sqlObj.columns
            //             .map((a) => {
            //                 return processTilde(a);
            //             })
            //             .join(", ");
            //     } else if (sqlObj.columns) {
            //         columnsStr = processTilde(sqlObj.columns);
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

            //     if (!limit || limit == null || (typeof limit === 'string' && limit.length <= 0)) {
            //         limit = process.env.MAX_RECORDS;
            //     }

            //     var sql = `SELECT ${columnsStr} FROM ${sqlObj.tables} `;

            //     // ----------------------
            //     // JOIN handling
            //     // sqlObj.joins can be:
            //     //  - an array of objects: [{type:'LEFT', table:'tbl_project_members pm', on:'p.id = pm.project_id'}, ...]
            //     //  - an array of strings: ["LEFT JOIN tbl_project_members pm ON p.id = pm.project_id", ...]
            //     //  - a single object or string
            //     // ----------------------
            //     if (sqlObj.joins) {
            //         var joinsArr = [];
            //         if (Array.isArray(sqlObj.joins)) {
            //             joinsArr = sqlObj.joins;
            //         } else {
            //             // object or string
            //             joinsArr = [sqlObj.joins];
            //         }

            //         joinsArr.forEach(function (j) {
            //             if (!j) return;

            //             if (typeof j === 'string') {
            //                 // raw join string (allow but be careful with injection)
            //                 sql += ' ' + processTilde(j) + ' ';
            //             } else if (typeof j === 'object') {
            //                 // expected fields: type, table, on
            //                 var typ = (j.type || 'INNER').toString().trim().toUpperCase();
            //                 if (typ !== 'INNER' && typ !== 'LEFT' && typ !== 'RIGHT' && typ !== 'CROSS' && typ !== 'FULL') {
            //                     // fallback to INNER for any unexpected type
            //                     typ = 'INNER';
            //                 }
            //                 var tbl = j.table ? processTilde(j.table) : false;
            //                 var on = j.on ? processTilde(j.on) : false;
            //                 if (tbl && on) {
            //                     sql += ` ${typ} JOIN ${tbl} ON ${on} `;
            //                 } else if (tbl && j.condition) {
            //                     // alternative property name 'condition'
            //                     sql += ` ${typ} JOIN ${tbl} ON ${processTilde(j.condition)} `;
            //                 }
            //             }
            //         });
            //     }

            //     var WHERE_ADDED = false;

            //     // normalize where: if string, keep as-is (after processTilde), else convert map
            //     if (typeof sqlObj.where == "string") {
            //         sqlObj.where = processTilde(sqlObj.where);
            //     } else if (sqlObj.where && typeof sqlObj.where === 'object') {
            //         var temp = {};
            //         _.each(sqlObj.where, function (k, v) {
            //             temp[processTilde(v)] = processTilde(k);
            //         });
            //         sqlObj.where = temp;
            //     }

            //     var sqlWhere = processSQLWhere(sqlObj.where, " ");
            //     console.log("sqlWhere", sqlWhere);
            //     if (sqlWhere && sqlWhere.length > 0) {
            //         sqlWhere = sqlWhere.replace(/``/g, "`");
            //         sql += " WHERE " + sqlWhere;
            //         WHERE_ADDED = true;
            //     }

            //     // filters (additional where clauses)
            //     if (typeof sqlObj.filter == "string") {
            //         sqlObj.filter = processTilde(sqlObj.filter);
            //     } else if (sqlObj.filter && typeof sqlObj.filter === 'object') {
            //         var tempf = {};
            //         _.each(sqlObj.filter, function (k, v) {
            //             tempf[processTilde(v)] = processTilde(k);
            //         });
            //         sqlObj.filter = tempf;
            //     }

            //     var sqlWhere2 = processSQLWhere(sqlObj.filter, " ");
            //     if (sqlWhere2 && sqlWhere2.length > 0) {
            //         sqlWhere2 = sqlWhere2.replace(/``/g, "`");
            //         if (WHERE_ADDED) sql += " AND " + sqlWhere2;
            //         else sql += " WHERE " + sqlWhere2;

            //         WHERE_ADDED = true;
            //     }

            //     // group by / having
            //     if (groupby && groupby.length > 0) {
            //         groupby = processTilde(groupby);
            //         sql += ` GROUP BY ${groupby}`;
            //     }
            //     if (having && having.length > 0) {
            //         having = processTilde(having);
            //         sql += ` HAVING ${having}`;
            //     }

            //     // order by
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

            //     // limit
            //     if (limit != null && limit > 0) {
            //         if (offset == null) {
            //             offset = 0;
            //         }
            //         sql += ` LIMIT ${offset}, ${limit}`;
            //     }

            //     // cleanup duplicate single-quotes
            //     sql = sql.replaceAll(/('')+/g, "'");
            //     sql = sql.replaceAll(/('')+/g, "'");

            //     return sql;
            // },

           

            



            // fetchJoinedData: function (params, callback) {
            //     if (!params || !params.tables || !Array.isArray(params.tables) || params.tables.length === 0) {
            //         console.log('fetchJoinedData: missing tables');
            //         return callback(false);
            //     }

            //     const DEFAULT_WHITELIST = {
            //         tbl_users: ['id', 'name', 'email', 'is_active', 'created_on', 'user_id'],
            //         tbl_projects: ['id', 'user_id', 'title', 'status', 'created_on'],
            //         tbl_project_tasks: ['id', 'project_id', 'title', 'assignee', 'due_date', 'status'],
            //         tbl_task_comments: ['id', 'task_id', 'user_id', 'comment', 'parent_comment_id'],
            //         tbl_attachments: ['id', 'task_id', 'file_name', 'file_path', 'uploaded_by'],
            //         tbl_team_members: ['id', 'project_id', 'user_id', 'role'],
            //         tbl_file_attachments: ['id', 'project_id', 'task_id', 'file_name', 'file_path', 'uploaded_by'],
            //         tbl_notifications: ['id', 'user_id', 'type', 'message', 'is_read', 'scheduled_on', 'sent_on']
            //         // extend as needed
            //     };

            //     const whitelist = params.whitelist && typeof params.whitelist === 'object'
            //         ? params.whitelist
            //         : DEFAULT_WHITELIST;

            //     function isSafeIdentifier(s) {
            //         return /^[A-Za-z0-9_]+$/.test(s);
            //     }

            //     function parseAliasCol(fragment) {
            //         const m = fragment.match(/^([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)(?:\s+as\s+([A-Za-z0-9_]+))?$/i);
            //         if (!m) return null;
            //         return { alias: m[1], col: m[2], asAlias: m[3] || null };
            //     }

            //     const tables = params.tables;
            //     const joins = params.joins || [];

            //     // Build alias -> table mapping from both tables[] and joins[].table BEFORE validating columns
            //     const aliasToTable = {};
            //     for (let t of tables) {
            //         if (!t || !t.name) {
            //             console.log('fetchJoinedData: invalid table entry', t);
            //             return callback(false);
            //         }
            //         const tableName = t.name;
            //         const alias = t.alias || tableName;
            //         if (!isSafeIdentifier(tableName) || !isSafeIdentifier(alias)) {
            //             console.log('fetchJoinedData: unsafe table or alias', tableName, alias);
            //             return callback(false);
            //         }
            //         if (!whitelist[tableName]) {
            //             console.log('fetchJoinedData: table not allowed by whitelist', tableName);
            //             return callback(false);
            //         }
            //         aliasToTable[alias] = tableName;
            //     }

            //     // Also register join tables' aliases so columns like p.title are recognized
            //     for (let j of joins) {
            //         if (!j || !j.table || !j.table.name) {
            //             // we'll validate join details later when building SQL; here just ensure alias mapping
            //             continue;
            //         }
            //         const jt = j.table;
            //         const tableName = jt.name;
            //         const alias = jt.alias || tableName;
            //         if (!isSafeIdentifier(tableName) || !isSafeIdentifier(alias)) {
            //             console.log('fetchJoinedData: unsafe join table or alias', jt);
            //             return callback(false);
            //         }
            //         if (!whitelist[tableName]) {
            //             console.log('fetchJoinedData: join table not allowed by whitelist', tableName);
            //             return callback(false);
            //         }
            //         // If alias already exists and points to different table -> error
            //         if (aliasToTable[alias] && aliasToTable[alias] !== tableName) {
            //             console.log('fetchJoinedData: alias collision', alias, aliasToTable[alias], tableName);
            //             return callback(false);
            //         }
            //         aliasToTable[alias] = tableName;
            //     }

            //     // Now validate columns and build SELECT
            //     const columns = params.columns || [];
            //     const rawColumns = params.rawColumns || [];
            //     const selectFragments = [];
            //     const sqlParams = [];

            //     if (Array.isArray(columns) && columns.length > 0) {
            //         for (let c of columns) {
            //             const parsed = parseAliasCol(c);
            //             if (!parsed) {
            //                 console.log('fetchJoinedData: invalid column format (use alias.col or alias.col as alias2):', c);
            //                 return callback(false);
            //             }
            //             const tableName = aliasToTable[parsed.alias];
            //             if (!tableName) {
            //                 console.log('fetchJoinedData: unknown alias in column:', parsed.alias);
            //                 return callback(false);
            //             }
            //             if (!whitelist[tableName].includes(parsed.col)) {
            //                 console.log('fetchJoinedData: column not allowed by whitelist', parsed.col, 'on table', tableName);
            //                 return callback(false);
            //             }
            //             if (parsed.asAlias) {
            //                 selectFragments.push('??.?? AS ??');
            //                 sqlParams.push(parsed.alias, parsed.col, parsed.asAlias);
            //             } else {
            //                 selectFragments.push('??.??');
            //                 sqlParams.push(parsed.alias, parsed.col);
            //             }
            //         }
            //     } else {
            //         const first = tables[0];
            //         selectFragments.push('??.*');
            //         sqlParams.push(first.alias || first.name);
            //     }

            //     if (Array.isArray(rawColumns) && rawColumns.length > 0) {
            //         for (let rc of rawColumns) {
            //             if (typeof rc !== 'string' || rc.trim().length === 0) {
            //                 console.log('fetchJoinedData: invalid raw column', rc);
            //                 return callback(false);
            //             }
            //             selectFragments.push(rc);
            //         }
            //     }

            //     // Build FROM clause
            //     let sql = 'SELECT ' + selectFragments.join(', ');
            //     const firstTable = tables[0];
            //     if (firstTable.alias && isSafeIdentifier(firstTable.alias)) {
            //         sql += ' FROM ?? AS ??';
            //         sqlParams.push(firstTable.name, firstTable.alias);
            //     } else {
            //         sql += ' FROM ??';
            //         sqlParams.push(firstTable.name);
            //     }

            //     // Build JOIN clauses (we already pre-registered aliases above)
            //     for (let j of joins) {
            //         if (!j || !j.table || !j.on) {
            //             console.log('fetchJoinedData: invalid join entry', j);
            //             return callback(false);
            //         }
            //         const type = (j.type || 'INNER').toUpperCase();
            //         const joinTable = j.table;
            //         if (!isSafeIdentifier(joinTable.name) || !isSafeIdentifier(joinTable.alias || joinTable.name)) {
            //             console.log('fetchJoinedData: unsafe join table or alias', joinTable);
            //             return callback(false);
            //         }
            //         if (!whitelist[joinTable.name]) {
            //             console.log('fetchJoinedData: join table not allowed by whitelist', joinTable.name);
            //             return callback(false);
            //         }
            //         if (joinTable.alias && isSafeIdentifier(joinTable.alias)) {
            //             sql += ` ${type} JOIN ?? AS ??`;
            //             sqlParams.push(joinTable.name, joinTable.alias);
            //         } else {
            //             sql += ` ${type} JOIN ??`;
            //             sqlParams.push(joinTable.name);
            //         }

            //         const left = j.on.left;
            //         const right = j.on.right;
            //         const leftMatch = (typeof left === 'string') && left.match(/^([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)$/);
            //         const rightMatch = (typeof right === 'string') && right.match(/^([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)$/);
            //         if (leftMatch && rightMatch) {
            //             const leftAlias = leftMatch[1], leftCol = leftMatch[2];
            //             const rightAlias = rightMatch[1], rightCol = rightMatch[2];
            //             if (!aliasToTable[leftAlias] || !aliasToTable[rightAlias]) {
            //                 console.log('fetchJoinedData: unknown alias in join ON', leftAlias, rightAlias);
            //                 return callback(false);
            //             }
            //             if (!whitelist[aliasToTable[leftAlias]].includes(leftCol) ||
            //                 !whitelist[aliasToTable[rightAlias]].includes(rightCol)) {
            //                 console.log('fetchJoinedData: join columns not allowed by whitelist', leftCol, rightCol);
            //                 return callback(false);
            //             }
            //             sql += ' ON ??.?? = ??.??';
            //             sqlParams.push(leftAlias, leftCol, rightAlias, rightCol);
            //         } else {
            //             console.log('fetchJoinedData: invalid join on clause', j.on);
            //             return callback(false);
            //         }
            //     }

            //     // WHERE
            //     const where = params.where || [];
            //     if (Array.isArray(where) && where.length > 0) {
            //         const whereParts = [];
            //         for (let w of where) {
            //             if (!w || typeof w.column !== 'string' || typeof w.operator === 'undefined') {
            //                 console.log('fetchJoinedData: invalid where item', w);
            //                 return callback(false);
            //             }
            //             const op = (w.operator || '=').toUpperCase();
            //             const colMatch = w.column.match(/^([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)$/);
            //             if (!colMatch) {
            //                 console.log('fetchJoinedData: invalid where column format', w.column);
            //                 return callback(false);
            //             }
            //             const alias = colMatch[1], col = colMatch[2];
            //             if (!aliasToTable[alias]) {
            //                 console.log('fetchJoinedData: unknown alias in where', alias);
            //                 return callback(false);
            //             }
            //             if (!whitelist[aliasToTable[alias]].includes(col)) {
            //                 console.log('fetchJoinedData: where column not allowed by whitelist', col);
            //                 return callback(false);
            //             }

            //             if (op === 'IN') {
            //                 if (!Array.isArray(w.value) || w.value.length === 0) {
            //                     console.log('fetchJoinedData: IN requires non-empty array value');
            //                     return callback(false);
            //                 }
            //                 const placeholders = w.value.map(_ => '?').join(', ');
            //                 whereParts.push('??.?? IN (' + placeholders + ')');
            //                 sqlParams.push(alias, col, ...w.value);
            //             } else if (op === 'IS' || op === 'IS NOT') {
            //                 whereParts.push('??.?? ' + op + ' ' + (w.value === null ? 'NULL' : '?'));
            //                 if (w.value !== null) sqlParams.push(alias, col, w.value);
            //                 else sqlParams.push(alias, col);
            //             } else {
            //                 whereParts.push('??.?? ' + op + ' ?');
            //                 sqlParams.push(alias, col, w.value);
            //             }
            //         }
            //         if (whereParts.length > 0) {
            //             sql += ' WHERE ' + whereParts.join(' AND ');
            //         }
            //     }

            //     // ORDER BY
            //     if (params.orderBy && typeof params.orderBy === 'string' && params.orderBy.trim().length > 0) {
            //         const clauses = params.orderBy.split(',').map(s => s.trim());
            //         const orderParts = [];
            //         for (let c of clauses) {
            //             const m = c.match(/^([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)(?:\s+(ASC|DESC))?$/i);
            //             if (!m) {
            //                 console.log('fetchJoinedData: invalid orderBy clause', c);
            //                 return callback(false);
            //             }
            //             const alias = m[1], col = m[2], dir = m[3] || '';
            //             if (!aliasToTable[alias]) {
            //                 console.log('fetchJoinedData: unknown alias in orderBy', alias);
            //                 return callback(false);
            //             }
            //             if (!whitelist[aliasToTable[alias]].includes(col)) {
            //                 console.log('fetchJoinedData: orderBy column not allowed', col);
            //                 return callback(false);
            //             }
            //             orderParts.push(`??.?? ${dir}`);
            //             sqlParams.push(alias, col);
            //         }
            //         if (orderParts.length) {
            //             sql += ' ORDER BY ' + orderParts.join(', ');
            //         }
            //     }

            //     // LIMIT/OFFSET
            //     const limit = Number.isFinite(params.limit) ? params.limit : null;
            //     const offset = Number.isFinite(params.offset) ? params.offset : null;
            //     if (limit !== null) {
            //         sql += ' LIMIT ?';
            //         sqlParams.push(limit);
            //         if (offset !== null) {
            //             sql += ' OFFSET ?';
            //             sqlParams.push(offset);
            //         }
            //     }

            //     // Execute
            //     pool.query(sql, sqlParams, function (err, rows) {
            //         if (err) {
            //             console.log('MYSQL fetchJoinedData error', err && err.message ? err.message : err);
            //             return callback(false);
            //         }
            //         return callback(rows || []);
            //     });
            // },



        };
    }
};
