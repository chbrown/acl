/// <reference path="../type_declarations/index.d.ts" />
import _ = require('lodash');
import async = require('async');
import chalk = require('chalk');
import fs = require('fs');
import path = require('path');
import logger = require('loge');
import util = require('util');
import tex = require('tex');

import text = require('../text');

var streaming = require('streaming');
var db = require('./db');

interface File {
  path: string;
  stats: fs.Stats;
}

var punctuation = /[,.:!'"()&]/g;

// interface (partially) matching the `paper` table in the PostgreSQL database
interface Paper {
  id: number;
  // reference data:
  pubtype: string;
  year: string;
  title: string;
  booktitle: string;
  author?: string;
  citekey?: string;
}

function resolveReferenceParagraph(referenceParagraph: string,
                                   callback: ErrorResultCallback<Paper>) {
  var select = db.Select('paper')
  .where('reference_string % $QUERY')
  // .where('reference_string <-> $QUERY < 0.6')
  .orderBy('reference_string <-> $QUERY')
  .limit(1);

  select.parameters.QUERY = referenceParagraph;

  select.execute((error: Error, rows: Paper[]) => {
    if (error) return callback(error);

    if (rows.length === 0) {
      logger.info(`Found no papers matching ${chalk.red(referenceParagraph)}`);
    }

    callback(null, rows[0]);
  });
}

/**
loadCitations iterates through all PDFs in the given directory (recursively), and:

1. parses each one
2. separates the reference paragraphs
3. resolves each reference plaintext to some paper in the database
*/
function loadCitations(root: string, callback: ErrorCallback) {
  new streaming.Walk(root)
  .pipe(new streaming.Transformer((file: File, encoding, callback: ErrorResultCallback<any>) => {
    var path_match = file.path.match(/\/(\w\d{2}-\d{4}).pdf$/)
    // reject non-pdfs
    if (path_match === null) {
      return callback();
    }
    var id = path_match[1];

    // Given a pdf's filepath, read it, parse it, and return the paragraphs as strings
    logger.info(`extracting text from ${chalk.cyan(file.path)}`);
    text.extract(file.path, (error, pdf_text) => {
      if (error) return callback(error);

      var pdf_paragraphs = pdf_text.split(/\n/);

      logger.info(`extracted ${pdf_text.length} characters from ${file.path}`);
      var references_index = pdf_paragraphs.indexOf('#References');
      if (references_index > -1) {
        var referenceParagraphs = pdf_paragraphs.slice(references_index + 1);
        logger.info(`found ${chalk.green('#References')} at paragraph ${references_index} / ${pdf_paragraphs.length} (N=${referenceParagraphs.length})`);

        async.map(referenceParagraphs, resolveReferenceParagraph, (error, papers: Paper[]) => {
          if (error) return callback(error);
          // filter out the null resolved papers (no match)
          papers = papers.filter(paper => !!paper);
          logger.info(`Resolved ${chalk.yellow(papers.length)} out of ${chalk.yellow(referenceParagraphs.length)} references`);
          // insert all the resolved matches as citations
          async.each(papers, (cited_paper: Paper, callback: ErrorCallback) => {
            db.Insert('citation')
            .set({
              citing_paper_id: id,
              cited_paper_id: cited_paper.id,
            })
            .execute(error => {
              // ignore unique constraint violations
              if (error && error.code === '23505') {
                return callback(null);
              }
              return callback(error);
            });
          }, (error) => {
            if (error) return callback(error);
            callback(null, {citing_paper_id: id, cited_papers_ids: papers.map(paper => paper.id)});
          });
        });
      }
      else {
        logger.info(`${chalk.red('found no "#References" paragraph')}`);
        callback(null, {error: 'No "#References" paragraph detected', id: id});
      }
    });
  }, {objectMode: true}))
  .pipe(new streaming.json.Stringifier())
  .pipe(process.stdout);
}

if (require.main === module) {
  var anthology_root = '/Volumes/Stephenson/acl-anthology/P/P13';
  logger.level = 'info'; // info | debug
  db.init(error => {
    if (error) throw error;
    loadCitations(anthology_root, error => {
      if (error) throw error;
      logger.info('DONE');
    });
  });
}
