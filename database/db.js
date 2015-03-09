var path = require('path');
var logger = require('loge');
var sqlcmd = require('sqlcmd-pg');

var db = new sqlcmd.Connection({
  host: '127.0.0.1',
  port: '5432',
  user: 'postgres',
  database: 'acl',
});

logger.level = 'info'; // info | debug

db.init = function(callback) {
  db.createDatabaseIfNotExists(function(err, exists) {
    if (err) return callback(err);
    var migrations_dirpath = path.join(__dirname, 'migrations');
    db.executePatches('_migrations', migrations_dirpath, callback);
  });
};

module.exports = db;
