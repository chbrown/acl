/// <reference path="types/all.d.ts" />

import logger = require('loge');
import redis = require('redis');
import request = require('request');

export function get(url: string, callback: (err: Error, body?: string) => void) {
  var redis_client = redis.createClient();

  var done = function(err: Error, result?: string) {
    redis_client.quit();
    // escape redis's ugly exception-intercepting clutches
    setImmediate(function() {
      return callback(err, result);
    });
  };

  redis_client.get(url, function(err, cached) {
    if (err) return done(err);

    if (cached) { //  && cached.length > 0
      logger.debug('Retrieved %s from cache', url);
      return done(null, cached);
    }

    request.get(url, function(err, response, body) {
      if (err) return done(err);
      if (response.statusCode != 200) {
        logger.error('Non-200 response', response);
      }

      // expires in 6 hours
      redis_client.setex(url, 6 * 60*60, body, function(err) {
        if (err) return done(err);

        logger.debug('Fetched %s from web', url);
        done(null, body);
      });
    });
  });
};
