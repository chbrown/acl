/*jslint node: true */
var logger = require('loge');
var redis = require('redis');
var request = require('request');

exports.get = function(url, callback) {
  var redis_client = redis.createClient();

  var done = function(err, result) {
    redis_client.quit();
    // escape redis's ugly exception-intercepting clutches
    setImmediate(function() {
      return callback(null, result);
    });
  };

  redis_client.get(url, function(err, cached) {
    if (err) return done(err);

    if (cached) { //  && cached.length > 0
      logger.debug('Found %s in cache', url);
      done(null, cached);
    }

    request.get(url, function(err, response, body) {
      if (err) return done(err);
      if (response.statusCode != 200) {
        logger.error('Non-200 response', response);
      }

      // expires in 6 hours
      redis_client.setex(url, 6 * 60*60, body, function(err) {
        if (err) return done(err);

        logger.debug('Retrieved %s from web', url);
        done(null, body);
      });
    });
  });
};
