// const { pool } = require('./db'); // adjust path
// const logger = require('./logger');

// Normalize record values
function normalizeRecord(rec, keys) {
  return keys.map(k => {
    let v = rec && Object.prototype.hasOwnProperty.call(rec, k) ? rec[k] : null;
    if (v === undefined) v = null;
    if (v !== null && typeof v === 'object') {
      try { return JSON.stringify(v); } catch (e) { return String(v); }
    }
    return v;
  });
}

// Insert rows one-by-one (used for duplicate handling fallback)
function insertRowsIndividually(table, keys, rows, allInsertedIds, cb, index = 0) {
  if (index >= rows.length) return cb(null);

  const vals = normalizeRecord(rows[index], keys);
  const placeholders = vals.map((_, i) => `$${i + 1}`).join(',');
  const cols = keys.map(k => `"${k}"`).join(',');
  const sql = `INSERT INTO "${table}" (${cols}) VALUES (${placeholders}) RETURNING id`;

  pool.query(sql, vals, function (err, res) {
    if (err) {
      if (err.code === '23505') { // unique_violation
        logger.info("Skipped duplicate row (unique_violation)", { table, index });
        return insertRowsIndividually(table, keys, rows, allInsertedIds, cb, index + 1);
      }
      logger.error("Individual insert error", err);
      return cb(err);
    }

    if (res?.rows?.[0]?.id !== undefined) {
      allInsertedIds.push(res.rows[0].id);
    } else {
      allInsertedIds.push(null);
    }
    insertRowsIndividually(table, keys, rows, allInsertedIds, cb, index + 1);
  });
}

// Perform batch insert
function performBatchInsert(table, keys, rows, allInsertedIds, nextOffset, processBatch, startNs, callback) {
  let paramIndex = 1;
  const rowPlaceholders = rows.map(() => {
    const ph = keys.map(() => `$${paramIndex++}`).join(',');
    return `(${ph})`;
  }).join(',');

  const vals = [];
  rows.forEach(r => normalizeRecord(r, keys).forEach(v => vals.push(v)));

  const cols = keys.map(k => `"${k}"`).join(',');
  const hasEmail = keys.includes('email');

  let sql = `INSERT INTO "${table}" (${cols}) VALUES ${rowPlaceholders}`;
  if (hasEmail) sql += ` ON CONFLICT ("email") DO NOTHING`;
  sql += ` RETURNING id`;

  pool.query(sql, vals, function (err, res) {
    if (err) {
      if (err.code === '23505') {
        logger.warn("Batch unique_violation, falling back to per-row insert", { table, error: err.message });
        return insertRowsIndividually(table, keys, rows, allInsertedIds, function (indErr) {
          if (indErr) {
            logger.error("Failed during individual inserts", indErr);
            return callback(false);
          }
          return processBatch(nextOffset);
        });
      }
      logger.error("Batch insert error", { sql, error: err.message });
      return callback(false);
    }

    if (res?.rows?.length) {
      res.rows.forEach(r => allInsertedIds.push(r.id ?? null));
    } else {
      logger.info("No rows inserted in batch (all duplicates?)", { table });
    }
    return processBatch(nextOffset);
  });
}

module.exports = {
  normalizeRecord,
  insertRowsIndividually,
  performBatchInsert
};
