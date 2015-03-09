/// <reference path="../type_declarations/index.d.ts" />

import async = require('async');
import fs = require('fs');
import glob = require('glob');
import path = require('path');
import logger = require('loge');
import util = require('util');
import text = require('../text');
import tex = require('tex');

var streaming = require('streaming');
var db = require('./db');

// setup logger
// db.on('log', function(ev) {
//   var args = [ev.format].concat(ev.args);
//   logger[ev.level].apply(logger, args);
// });

logger.level = 'info'; // info | debug

interface File {
  path: string;
  stats: fs.Stats;
}

function readBibfile(filepath: string, callback: (error: Error, reference?: tex.Reference) => void) {
  fs.readFile(filepath, {encoding: 'utf8'}, (error: Error, bibtex: string) => {
    if (error) return callback(error);

    tex.bibtex.parse(bibtex, (error: Error, references: tex.Reference[]) => {
      if (error) return callback(error);

      if (references.length === 0) {
        return callback(new Error(`No references in file: ${filepath}`));
      }
      if (references.length !== 1) {
        return callback(new Error(`Too many references in file: ${filepath} (${references.length})`));
      }

      callback(null, references[0]);
    });
  });
}

function addPaper(bib_filepath: string, pdf_filepath: string,
                  callback: (error: Error, result?: any) => void) {
  readBibfile(bib_filepath, (error: Error, reference: tex.Reference) => {
    if (error) {
      // skippable error
      return callback(null, {error: error.message});
    }
    logger.info(`read reference from ${bib_filepath}: @${reference.type} ${reference.key}`);

    text.extract(pdf_filepath, function(error, pdf_text) {
      if (error) {
        // another skippable error
        return callback(null, {error: error.message});
      }
      logger.info(`extracted ${pdf_text.length} characters from ${pdf_filepath}`);

      db.Insert('paper')
      .set({
        filebase: pdf_filepath.match(/\/(\w\d{2}-\d{4}).pdf$/)[1],
        // postgresql doesn't like null bytes
        text: pdf_text.replace(/\x00/g, ''),
        reference: reference
      })
      .returning('*')
      .execute((error, rows) => {
        // don't skip over this error
        if (error) return callback(error);

        var paper = rows[0];

        // okay, now we know both the pdf and the bib file exist and need to be processed!
        callback(null, {id: paper.id, filebase: paper.filebase});
      });
    });
  });
}

function main(callback: (error: Error) => void) {
  var anthology_root = '/Volumes/Stephenson/acl-anthology';

  new streaming.Walk(anthology_root)
  .pipe(new streaming.Transformer(function(file: File, encoding, callback: (error?: Error, outputChunk?: any) => void) {
    // suppose file.path == /Volumes/External/acl-anthology/W/W12/W12-0911.pdf
    var path_match = file.path.match(/\/(\w\d{2}-\d{4}).pdf$/)
    // path_match[1] = W12-0911

    // reject non-PDFs
    if (!path_match) return callback();

    var bib_filepath = file.path.replace(/pdf$/, 'bib');
    fs.exists(bib_filepath, (exists) => {

      // reject PDFs that don't have a corresponding .bib file
      if (!exists) return callback();

      var filebase = path_match[1];

      db.Select('paper').add('id')
      .whereEqual({filebase: filebase})
      .limit(1)
      .execute((err, rows) => {
        if (err) return callback(err);
        // reject files that have already been processed
        if (rows.length > 0) return callback();

        // okay, now we know both the pdf and the bib file exist and need to be processed!
        addPaper(bib_filepath, file.path, callback);
      });
    });
  }, {objectMode: true}))
  // .pipe(new streaming.Queue(10, function(pdf_file: File, callback: (err: Error, obj?: any) => void) {
  //   var bib_filepath = file.path.replace(/pdf$/, 'bib');
  //   addPaper(bib_filepath, pdf_file.path, callback);
  // }))
  .pipe(new streaming.json.Stringifier())
  .pipe(process.stdout);
}

if (require.main === module) {
  db.init(function(err) {
    if (err) throw err;
    main(function(err: Error) {
      if (err) throw err;
      logger.info('DONE');
    });
  });
}
