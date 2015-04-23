var path = require('path');
var logger = require('loge');
var sqlcmd = require('sqlcmd-pg');

var db = new sqlcmd.Connection({
  host: '127.0.0.1',
  port: '5432',
  user: 'postgres',
  database: 'acl',
});

db.init = function(callback) {
  db.createDatabaseIfNotExists(function(err) {
    if (err) return callback(err);
    var migrations_dirpath = path.join(__dirname, 'migrations');
    db.executePatches('_migrations', migrations_dirpath, callback);
  });
};

// connect db log events to local logger
db.on('log', function(ev) {
  var args = [ev.format].concat(ev.args);
  logger[ev.level].apply(logger, args);
});

module.exports = db;
