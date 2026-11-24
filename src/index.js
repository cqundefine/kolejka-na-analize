'use strict';

const { loadConfig } = require('./config');
const { openDatabase } = require('./db');
const { createQueue } = require('./queue');
const { createWhitelist } = require('./whitelist');
const { createAdminAuth } = require('./auth');
const { createSettings } = require('./settings');
const { createServer } = require('./server');

const config = loadConfig();
const db = openDatabase(config.database.path);
const queue = createQueue(db, config.queue);
const whitelist = createWhitelist({ file: config.whitelist.file, maxLength: config.name.maxLength });
const auth = createAdminAuth(db, config.admin);
const settings = createSettings(db, config.queue);
const server = createServer({ config, queue, whitelist, auth, settings });

server.listen(config.server.port, config.server.host, () => {
  console.log(`Kolejka działa na http://${config.server.host}:${config.server.port}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
