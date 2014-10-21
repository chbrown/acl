/*jslint node: true */
var _ = require('lodash');
var async = require('async');
var fs = require('fs');
var glob = require('glob');
var path = require('path');
var streaming = require('streaming');
var logger = require('loge');
var util = require('util');
var request = require('request');

var bibtex = require('tex/bibtex');

// var index = 'acl';
// var type = 'reference';

var addReference = function(reference, callback) {
  request.put({
    url: 'http://localhost:9200/acl/reference/' + reference.citekey,
    body: JSON.stringify(reference),
    json: true,
  }, function(err, res, body) {
    callback(err, body);
  });
};


function finalize(err) {
  if (err) throw err;
  logger.info('DONE');
}

var main = function(callback) {
  /** walks through all ./anthology/.../P##-####.bib files
  Parses them and adds them to the local elasticsearch server,
  using the given citekey as the document's _id
  */
  new streaming.Walk(path.join(__dirname, 'anthology'))
  .pipe(new streaming.Filter(function(file) {
    // file has .path and .stats properties
    return file.path.match(/P\d{2}-\d{4}.bib$/); // && node.stats.isFile();
  }))
  .pipe(new streaming.Queue(10, function(file, callback) {
    fs.readFile(file.path, {encoding: 'utf8'}, function(err, bibtex_string) {
      if (err) return callback(err);

      bibtex.parse(bibtex_string, function(err, references) {
        if (err) return callback(err);
        if (references.length != 1) {
          return callback(new Error('Too many references in file: ' + file.path));
        }

        var reference = references[0];
        addReference(reference.toJSON(), function(err, body) {
          if (err) return callback(err);
          callback(null, {reference: reference, response: body});
        });
      });
    });
  }))
  .pipe(new streaming.json.Stringifier())
  .pipe(process.stdout);
};

main(finalize);
