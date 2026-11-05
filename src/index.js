'use strict';

const { loadConfig } = require('./config');
const { openDatabase } = require('./db');
const { createQueue } = require('./queue');
const { createAdminAuth } = require('./auth');
const { createServer } = require('./server');

const config = loadConfig();
const db = openDatabase(config.database.path);
const queue = createQueue(db, config.queue);
const auth = createAdminAuth(db, config.admin);
const server = createServer({ config, queue, auth });

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
