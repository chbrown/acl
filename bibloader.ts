/// <reference path="type_declarations/index.d.ts" />

import _ = require('lodash');
import async = require('async');
import fs = require('fs');
import glob = require('glob');
import path = require('path');
import logger = require('loge');
import util = require('util');
import request = require('request');

var streaming = require('streaming');
var tex = require('tex');

interface ReferenceTag {
  key: string;
  value: string;
}

interface Reference {
  type: string;
  key: string;
  tags: ReferenceTag[];

  toJSON(): any;
}

interface File {
  path: string;
  stats: any;
}

function addReference(reference: Reference, callback: (err: Error, body?: string) => void) {
  //logger.info('adding reference: @%s: %s', reference.type, reference.key);
  request.put({
    url: 'http://localhost:9200/acl/reference/' + reference.key,
    body: JSON.stringify(reference.toJSON()),
    json: true,
  }, function(err, res, body) {
    callback(err, body);
  });
}

function main(callback: ErrorCallback) {
  /** walks through all ./anthology/.../P##-####.bib files
  Parses them and adds them to the local elasticsearch server,
  using the given citekey as the document's _id
  */
  var anthology_root = '/Users/chbrown/github/acl-anthology';

  new streaming.Walk(anthology_root)
  .pipe(new streaming.Filter(function(file: File) {
    // file has .path and .stats properties
    return file.path.match(/\/\w\d{2}-\d{4}.bib$/); // && node.stats.isFile();
  }))
  .pipe(new streaming.Queue(10, function(file: File, callback: (err: Error, obj?: any) => void) {
    fs.readFile(file.path, {encoding: 'utf8'}, function(err: Error, bibtex_string: string) {
      if (err) return callback(err);

      tex.bibtex.parse(bibtex_string, function(err: Error, references: Reference[]) {
        if (err) return callback(err);
        if (references.length === 0) {
          logger.error('No references in file: %s', file.path);
          return callback(null, {error: true});
        }
        if (references.length !== 1) {
          logger.error('Too many references in file: %s', file.path);
          return callback(null, {error: true});
        }

        var reference = references[0];
        addReference(reference, function(err, body) {
          if (err) return callback(err);
          callback(null, {reference: reference, response: body});
        });
      });
    });
  }))
  .pipe(new streaming.json.Stringifier())
  .pipe(process.stdout);
}

if (require.main === module) {
  main(function(err: Error) {
    if (err) throw err;
    logger.info('DONE');
  });
}
