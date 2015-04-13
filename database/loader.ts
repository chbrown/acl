/// <reference path="../type_declarations/index.d.ts" />
import _ = require('lodash');
import chalk = require('chalk');
import fs = require('fs');
import path = require('path');
import logger = require('loge');
import tex = require('tex');

var streaming = require('streaming');
var db = require('./db');

interface File {
  path: string;
  stats: fs.Stats;
}

/**
Given a bibfile's filepath, read it, parse it, and return the Reference instance
*/
function readBibfile(filepath: string, callback: (error: Error, reference?: tex.bib.Reference) => void) {
  fs.readFile(filepath, {encoding: 'utf8'}, (error: Error, bibtex: string) => {
    if (error) return callback(error);

    var references: tex.bib.Reference[];
    try {
      // do not callback() from inside a try { }
      references = tex.bib.parseReferences(bibtex);
    }
    catch (exc) {
      logger.error(`failed while reading ${filepath}`);
      return callback(exc);
    }

    // check that we parsed exactly one reference
    if (references.length === 0) {
      return callback(new Error(`No references in file: ${filepath}`));
    }
    if (references.length !== 1) {
      return callback(new Error(`Too many references in file: ${filepath} (${references.length})`));
    }
    // .replace(/\x00/g, ''), // postgresql doesn't like null bytes
    callback(null, references[0]);
  });
}

/**
loadPapers reads through the given directory recursively, adding every
???-????.bib file (i.e., not the ???-?.bib compilations) to the `papers` table.
*/
function loadBibfiles(root: string, callback: ErrorCallback) {
  new streaming.Walk(root)
  .pipe(new streaming.Transformer((file: File, encoding, callback: ErrorResultCallback<any>) => {
    // suppose file.path == /Volumes/External/acl-anthology/W/W12/W12-0911.bib
    var path_match = file.path.match(/\/(\w\d{2}-\d{4}).bib$/)
    // reject non-bibfiles
    if (path_match === null) {
      return callback();
    }
    readBibfile(file.path, (error: Error, reference: tex.bib.Reference) => {
      if (error) return callback(error);

      // logger.debug(`read reference from ${file.path}: @${reference.pubtype}{${reference.citekey}, ...}`);

      var paper = _.pick(reference.toJSON(), ['pubtype', 'year', 'title', 'address', 'booktitle', 'pages', 'author', 'month', 'citekey', 'publisher', 'url', 'doi']);
      // path_match[1] = W12-0911
      paper['id'] = path_match[1];

      db.Insert('paper')
      .set(paper)
      .returning('*')
      .execute((error, rows) => {
        if (error) {
          // skip over this error if it's a duplicate
          if (error.code === '23505') {
            return callback(null, {message: 'duplicate'});
          }
          else {
            return callback(error);
          }
        }

        var paper = rows[0];

        callback(null, {id: paper.id});
      });
    });
  }, {objectMode: true}))
  // .pipe(new streaming.Queue(10, (pdf_file: File, callback: (err: Error, obj?: any) => void) => {
  //   var bib_filepath = file.path.replace(/pdf$/, 'bib');
  //   addPaper(bib_filepath, pdf_file.path, callback);
  // }))
  .pipe(new streaming.json.Stringifier())
  .pipe(process.stdout);
}

if (require.main === module) {
  var anthology_root = '/Volumes/Stephenson/acl-anthology';
  logger.level = 'info'; // info | debug
  db.init(error => {
    if (error) throw error;
    loadBibfiles(anthology_root, error => {
      if (error) throw error;
      logger.info('DONE');
    });
  });
}
