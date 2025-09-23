// api/libs/postgres.js
// Requires: npm i pg

const { Pool } = require('pg');
const VALIDATOR = require('../helpers/validations')
const TIME = require('../helpers/formatduration');

const poolMap = {};

// --- helper: normalize record values ---
function normalizeRecord(rec, keys) {
  return keys.map(k => {
    let v = rec && Object.prototype.hasOwnProperty.call(rec, k) ? rec[k] : null;
    if (v === undefined) v = null;

    if (v !== null && typeof v === 'object') {
      try { return JSON.stringify(v); } catch (e) { return String(v); }
    }

    if (k === 'email' && v !== null && v !== undefined) {
      return String(v).trim().toLowerCase();
    }

    if (typeof v === 'string') return v.trim();
    return v;
  });
}


// --- helper: insert rows individually (fallback for duplicates) ---
function insertRowsIndividually(pool, table, keys, rows, allInsertedIds, index, done) {
  if (index >= rows.length) return done(null);

  const vals = normalizeRecord(rows[index], keys);
  const placeholders = vals.map((_, i) => `$${i + 1}`).join(',');
  const cols = keys.map(k => `"${k}"`).join(',');
  const sql = `INSERT INTO "${table}" (${cols}) VALUES (${placeholders}) RETURNING id`;

  pool.query(sql, vals, (err, res) => {
    if (err) {
      if (err.code === '23505') { // skip duplicate
        logger.info(`Skipped duplicate row in table ${table}, index ${index}`);
        return insertRowsIndividually(pool, table, keys, rows, allInsertedIds, index + 1, done);
      }
      logger.error('Individual insert error:', err);
      return done(err);
    }

    if (res?.rows?.[0]?.id !== undefined) {
      allInsertedIds.push(res.rows[0].id);
    } else {
      allInsertedIds.push(null);
    }

    insertRowsIndividually(pool, table, keys, rows, allInsertedIds, index + 1, done);
  });
}

// --- helper: batch insert ---
function performBatchInsert(pool, table, keys, rows, allInsertedIds, nextOffset, processBatch, startNs, callback) {
  let paramIndex = 1;
  const rowPlaceholders = rows.map(() => {
    const ph = keys.map(() => `$${paramIndex++}`).join(',');
    return `(${ph})`;
  }).join(',');

  const vals = [];
  rows.forEach(r => normalizeRecord(r, keys).forEach(v => vals.push(v)));

  const cols = keys.map(k => `"${k}"`).join(',');
  let sql = `INSERT INTO "${table}" (${cols}) VALUES ${rowPlaceholders}`;

  if (keys.includes('email')) {
    sql += ` ON CONFLICT ("email") DO NOTHING`;
  }
  sql += ` RETURNING id`;

  pool.query(sql, vals, (err, res) => {
    if (err) {
      if (err.code === '23505') {
        logger.warn(`Batch unique_violation in ${table}, falling back to individual inserts`);
        return insertRowsIndividually(pool, table, keys, rows, allInsertedIds, 0, (errInd) => {
          if (errInd) {
            const durationMsErr = Number(process.hrtime.bigint() - startNs) / 1e6;
            logger.error(`Failed during individual inserts after ${durationMsErr.toFixed(2)} ms`, errInd);
            return callback(false);
          }
          return processBatch(nextOffset);
        });
      }

      const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
      logger.error('Batch insert error:', err.message || err, sql);
      logger.info(`Insert failed after ${durationMs.toFixed(2)} ms`);
      return callback(false);
    }

    if (res?.rows?.length) {
      res.rows.forEach(r => allInsertedIds.push(r.id ?? null));
    } else {
      logger.info(`No rows inserted in batch (all duplicates?) for table ${table}`);
    }

    return processBatch(nextOffset);
  });
}

module.exports = {
  poolMap,

  // connect(params, callback) -> callback(wrapper) or callback(false)
  connect: function (params, callback) {
    if (!params) {
      logger.info('POSTGRES.connect called without params');
      return callback(false);
    }

    const key = params.dbkey || (params.database ? params.database : (params.host + ':' + params.port));

    if (this.poolMap[key]) {
      return callback(this._wrap(this.poolMap[key], params));
    }

    const host = params.host || '127.0.0.1';
    const port = params.port ? parseInt(params.port, 10) : 5432;
    const user = params.user || params.username || 'postgres';
    const password = params.pwd || params.password || '';
    const database = params.database || '';

    logger.info(`POSTGRES.connect -> host=${host} port=${port} db=${database} user=${user}`);

    const pool = new Pool({
      host,
      port,
      user,
      password,
      database,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 30000,
    });

    // test connection
    pool.connect((err, client, release) => {
      if (err) {
        logger.error('POSTGRES.connect error:', err && err.message ? err.message : err);
        try { pool.end(); } catch (e) { }
        return callback(false);
      }
      release();
      this.poolMap[key] = pool;
      const wrapper = this._wrap(pool, params);
      return callback(wrapper);
    });
  },

  disconnect: function (params, callback) {
    const key = params.dbkey || (params.database ? params.database : (params.host + ':' + params.port));
    const pool = this.poolMap[key];
    if (pool) {
      pool.end().then(() => {
        delete this.poolMap[key];
        if (callback) callback(true);
      }).catch(e => {
        logger.error('POSTGRES.disconnect error', e);
        if (callback) callback(false);
      });
    } else {
      if (callback) callback(false);
    }
  },

  // Internal wrapper providing the same methods your app expects
  _wrap: function (pool, params) {
    const outer = module.exports
    return {
      // listTables(callback)
      listTables: function (callback) {
        const sql = `SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
        const startNs = process.hrtime.bigint();
        pool.query(sql, [], (err, res) => {
          const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
          logger.info(`POSTGRES listTables query time: ${durationMs.toFixed(3)} ms`);
          if (err) {
            logger.error('POSTGRES listTables error', err && err.message ? err.message : err);
            return callback([]);
          }
          const tables = res.rows.map(r => r.tablename);
          tables.push({ _queryTimes: TIME.executionTime(durationMs) });
          callback(tables);
        });
      },

      // listData(params, callback) - supports params.columns (array), params.filter (object with $eq/$in/$ne/$lt/$lte/$gt/$gte), params.orderby (string)
      listData: function (params, callback) {
        if (!params || !params.table) return callback([]);

        const table = params.table;
        let cols = '*';
        if (params.columns && Array.isArray(params.columns) && params.columns.length > 0) {
          cols = params.columns.map(c => `"${c}"`).join(', ');
        }

        // build WHERE from params.filter
        let where = '';
        const values = [];
        if (params.filter && typeof params.filter === 'object') {
          const parts = [];
          Object.keys(params.filter).forEach((k) => {
            const v = params.filter[k];
            // v can be { $eq: x } or simple value
            if (v && typeof v === 'object') {
              if (v.$eq !== undefined) {
                parts.push(`"${k}" = $${values.length + 1}`); values.push(v.$eq);
              } else if (v.$in !== undefined) {
                const arr = Array.isArray(v.$in) ? v.$in : (('' + v.$in).split(','));
                const placeholders = arr.map(() => `$${values.length + 1 + placeholdersIndex++}`); // not used - replaced below
                // simpler approach:
                const startIndex = values.length + 1;
                values.push(...arr);
                const ph = arr.map((_, i) => `$${startIndex + i}`).join(',');
                parts.push(`"${k}" IN (${ph})`);
              } else if (v.$ne !== undefined) {
                parts.push(`"${k}" <> $${values.length + 1}`); values.push(v.$ne);
              } else if (v.$lt !== undefined) {
                parts.push(`"${k}" < $${values.length + 1}`); values.push(v.$lt);
              } else if (v.$lte !== undefined) {
                parts.push(`"${k}" <= $${values.length + 1}`); values.push(v.$lte);
              } else if (v.$gt !== undefined) {
                parts.push(`"${k}" > $${values.length + 1}`); values.push(v.$gt);
              } else if (v.$gte !== undefined) {
                parts.push(`"${k}" >= $${values.length + 1}`); values.push(v.$gte);
              } else {
                // fallback: equality with stringified object
                parts.push(`"${k}" = $${values.length + 1}`); values.push(v);
              }
            } else {
              // scalar -> equality
              parts.push(`"${k}" = $${values.length + 1}`); values.push(v);
            }
          });

          if (parts.length) where = ' WHERE ' + parts.join(' AND ');
        }

        // ORDER BY
        let sql = `SELECT ${cols} FROM "${table}"${where}`;
        if (params.orderby) {
          // trust simple "col ASC/DESC" format
          sql += 'WHERE is_active = true ORDER BY ' + params.orderby;
        }

        sql += ' LIMIT 1000';

        // debug
        // console.log('POSTGRES listData SQL:', sql, values);
        const startNs = process.hrtime.bigint();
        pool.query(sql, values, (err, res) => {
          const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
          logger.info(`POSTGRES listData for table ${table} took ${durationMs.toFixed(2)} ms`);
          if (err) {
            logger.error('POSTGRES listData error for table', table, err && err.message ? err.message : err, sql);
            return callback([]);
          }
          const rows = res.rows || [];
          rows.push({ _queryTimes: TIME.executionTime(durationMs) }); // append timing info
          callback(rows);
        });
      },

      // fetchData(params, callback) - expects params.idhash
      fetchData: function (params, callback) {
        if (!params || !params.table) return callback(false);
        const table = params.table;
        const id = params.idhash || params.id;
        if (!id) return callback(false);

        const sql = `SELECT * FROM "${table}" WHERE id = $1 LIMIT 1`;
        pool.query(sql, [id], (err, res) => {
          if (err) {
            logger.error('POSTGRES fetchData error', err && err.message ? err.message : err);
            return callback(false);
          }
          if (!res.rows || res.rows.length === 0) return callback(false);
          callback(res.rows[0]);
        });
      },

      // insertData: function (params, recordData, callback) {
      //   logger.info("POSTGRES insertData called with params:", params, "recordData:", recordData);
      // //   const validation = VALIDATOR.validateRule(
      // //   { firstName, email },
      // //   {
      // //     firstName: constants.NAME_RULE,
      // //     email: constants.EMAIL_RULE,
      // //   }
      // // );
      //   // const validation = VALIDATOR.validateRule({
      //   //   name: recordData.name, email: recordData.email, mobile: recordData.mobile
      //   // },
      //   //   {
      //   //     name: 'required|string', email: 'required|email', mobile: 'required|regex:/^[0-9]{10}$/'
      //   //   });

      //   //   if (!validation.status){
      //   //     logger.error("vaidation failed", validation.errors);
      //   //     return callback(false, validation.errors);
      //   //   }

      //   if (!params || !params.table) return callback(false);
      //   const table = params.table;

      //   const rec = {};
      //   Object.keys(recordData).forEach(k => {
      //     const v = recordData[k];
      //     if (v === undefined) return;
      //     // convert objects/arrays to JSON for PostgreSQL JSON columns compatibility
      //     if (typeof v === 'object') rec[k] = JSON.stringify(v);
      //     else rec[k] = v;
      //   });

      //   const keys = Object.keys(rec);
      //   if (keys.length === 0) return callback(false);

      //   const cols = keys.map(k => `"${k}"`).join(',');
      //   const placeholders = keys.map((_, i) => `$${i + 1}`).join(',');
      //   const vals = keys.map(k => rec[k]);

      //   // RETURNING id (assumes table uses 'id' primary key)
      //   const sql = `INSERT INTO "${table}" (${cols}) VALUES (${placeholders}) RETURNING id`;
      //   const startNs = process.hrtime.bigint();
      //   pool.query(sql, vals, (err, res) => {
      //     const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
      //     if (err) {
      //       logger.error('POSTGRES insertData error', err && err.message ? err.message : err, sql);
      //       return callback(false);
      //     }
      //     const insertedId = [{ID: res.rows && res.rows[0] && res.rows[0].id ? res.rows[0].id : null}, TIME.executionTime(durationMs)];
      //     callback([{ _id: insertedId }]);
      //   });
      // },

      // updateData(params, recordData, callback) - expects params.idhash

      insertData: function (params, recordData, callback) {
        if (!params || !params.table) return callback(false);
        const table = params.table;

        if (!/^[A-Za-z0-9_]+$/.test(table)) return callback(false);

        const BATCH_LIMIT = (global.BATCH_LIMIT && Number(global.BATCH_LIMIT)) || 3;
        const isArray = Array.isArray(recordData);
        const records = isArray ? recordData : [recordData];
        if (!records || records.length === 0) return callback(false);

        const startNs = process.hrtime.bigint();
        const keySet = new Set();
        records.forEach(r => r && Object.keys(r).forEach(k => keySet.add(k)));
        const keys = Array.from(keySet);
        if (keys.length === 0) return callback(false);

        const allInsertedIds = [];

        const processBatch = (offset) => {
          if (offset >= records.length) {
            const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
            logger.info(`insertData done in ${durationMs.toFixed(2)} ms`);
            const result = [{ _id: isArray ? allInsertedIds : (allInsertedIds[0] || null) }];
            return callback(result);
          }
          const batch = records.slice(offset, offset + BATCH_LIMIT);
          performBatchInsert(pool, table, keys, batch, allInsertedIds, offset + BATCH_LIMIT, processBatch, startNs, callback);
        };

        processBatch(0);
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

        const keys = Object.keys(rec);
        if (keys.length === 0) return callback(false);

        const sets = keys.map((k, i) => `"${k}" = $${i + 1}`).join(',');
        const vals = keys.map(k => rec[k]);
        vals.push(id); // for WHERE id = $n

        const sql = `UPDATE "${table}" SET ${sets} WHERE id = $${keys.length + 1} RETURNING id`;
        const startNs = process.hrtime.bigint();
        logger.info("Update SQL:", sql, "Values:", vals);
        pool.query(sql, vals, (err, res) => {
          const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
          logger.info(`POSTGRES updateData for table ${table} took ${durationMs.toFixed(2)} ms`);
          if (err) {
            logger.error('POSTGRES updateData error', err && err.message ? err.message : err);
            return callback(false);
          }
          // return returning row (if exists)
          const updatedId = [{ id: res.rows && res.rows[0] && res.rows[0].id ? res.rows[0].id : null }, TIME.executionTime(durationMs)];
          callback({ _id: updatedId });
        });
      },

      // deleteData(params, callback) - expects params.idhash
      deleteData: function (params, callback) {
        if (!params || !params.table || !params.idhash) return callback(false);
        const table = params.table;
        const id = params.idhash;
        const sql = `DELETE FROM "${table}" WHERE id = $1`;
        pool.query(sql, [id], (err, res) => {
          if (err) {
            logger.error('POSTGRES deleteData error', err && err.message ? err.message : err);
            return callback(false);
          }
          if (res.rowCount === 0) {
            logger.error('POSTGRES deleteData no rows affected for id', id);
            return callback(false);
          }
          logger.info('POSTGRES deleteData success for id', id);
          callback(res);
        });
      },

      // getSchema(params, callback) - returns { paths: { ... } } to mimic mongo schema format
      getSchema: function (params, callback) {
        if (!params || !params.table) return callback(false);
        const table = params.table;

        const sql = `
          SELECT c.column_name, c.data_type, c.column_default, c.is_nullable,
                 pgd.description AS column_comment
          FROM information_schema.columns c
          LEFT JOIN pg_catalog.pg_statio_all_tables st ON (st.schemaname = c.table_schema AND st.relname = c.table_name)
          LEFT JOIN pg_catalog.pg_description pgd ON (pgd.objoid = st.relid AND pgd.objsubid = c.ordinal_position)
          WHERE c.table_schema = 'public' AND c.table_name = $1
          ORDER BY c.ordinal_position
        `;
        const startNs = process.hrtime.bigint();
        pool.query(sql, [table], (err, res) => {
          const endNs = process.hrtime.bigint();
          const durationMs = Number(endNs - startNs) / 1e6;
          logger.info(`POSTGRES getSchema for table ${table} took ${durationMs.toFixed(2)} ms`);
          logger.info("Response: ", res);
          if (err) {
            logger.error('POSTGRES getSchema error', err && err.message ? err.message : err);
            return callback(false);
          }

          const rows = res.rows || [];
          let paths = {};
          rows.forEach(col => {
            paths[col.column_name] = {
              instance: (col.data_type || '').toUpperCase(),
              validators: [],
              default: col.column_default,
              nullable: col.is_nullable,
              comment: col.column_comment || ''
            };
          });
          paths._queryTimes = TIME.executionTime(durationMs);

          callback({ paths });
        });
      }

    };
  }
};
