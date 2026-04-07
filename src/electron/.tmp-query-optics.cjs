const Database = require('better-sqlite3');
try {
  const db = new Database('database.sqlite', { readonly: true });
  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='muse_raw_optics'").get();
  if (!tableExists) {
    console.log(JSON.stringify({ table: 'muse_raw_optics', exists: false }, null, 2));
    process.exit(0);
  }

  const count = db.prepare('SELECT COUNT(*) AS c FROM muse_raw_optics').get();
  const minMax = db.prepare('SELECT MIN(timestamp) AS first_ts, MAX(timestamp) AS last_ts FROM muse_raw_optics').get();
  const latest = db.prepare('SELECT id, timestamp, ch0, ch1, ch2, ch3 FROM muse_raw_optics ORDER BY timestamp DESC LIMIT 5').all();
  const chStats = db.prepare(`SELECT AVG(ch0) as avg_ch0, AVG(ch1) as avg_ch1, AVG(ch2) as avg_ch2, AVG(ch3) as avg_ch3,
                                    MIN(ch0) as min_ch0, MIN(ch1) as min_ch1, MIN(ch2) as min_ch2, MIN(ch3) as min_ch3,
                                    MAX(ch0) as max_ch0, MAX(ch1) as max_ch1, MAX(ch2) as max_ch2, MAX(ch3) as max_ch3
                             FROM muse_raw_optics`).get();

  console.log(JSON.stringify({
    table: 'muse_raw_optics',
    exists: true,
    row_count: count.c,
    first_timestamp: minMax.first_ts,
    last_timestamp: minMax.last_ts,
    latest_rows: latest,
    channel_stats: chStats
  }, null, 2));
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}
