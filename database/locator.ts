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
import {File, countOccurrences} from '../common';
import {Article, Paper, PaperRow} from '../models';

var streaming = require('streaming');
var db = require('./db');

/**
loadLocations iterates through all PDFs in the given directory recursively.
For each PDF:

1. list all the papers that it cites (citedPapers) as per the `paper` table in the database
2. extract the text for the citing paper
3. search through the text for all the patterns for each cited paper
*/
function loadLocations(root: string, callback: ErrorCallback) {
  Article.stream(root).pipe(new streaming.Transformer((article: Article, encoding: string, callback: ErrorResultCallback<any>) => {
    logger.info(`Locating in ${article.id} - "${article.pdf_filepath}"`);

    db.Select('paper, citation')
    .where('paper.id = citation.cited_paper_id')
    .whereEqual({citing_paper_id: article.id})
    .execute((error, citedPapers: PaperRow[]) => {
      if (error) return callback(error);
      if (citedPapers.length === 0) {
        logger.info(`No citations found for the paper "${article.id}"`);
        return callback(null, {});
      }

      // Given a pdf's filepath, read it, parse it, and return the paragraphs as strings
      article.getParagraphs((error: Error, paragraphs: string[]) => {
        if (error) return callback(error);
        var content = paragraphs.join('\n');

        // var referencePatterns = [
        //   /[A-Z]\S+ et al. \(\d{4}[a-f]?\)/g,
        //   /[A-Z]\S+ and [A-Z]\S+ \(\d{4}[a-f]?\)/g,
        //   /[A-Z]\S+ (\d{4}[a-f]?)/g,
        //   /[A-Z]\S+ et al., \d{4}[a-f]?\b/g,
        //   /[A-Z]\S+ and [A-Z]\S+, \d{4}[a-f]?\b/g,
        //   /[A-Z]\S+, \d{4}[a-f]?\b/g,
        // ];
        // referencePatterns.forEach(referencePattern => {
        //   (content.match(referencePattern) || []).forEach(match => {
        //     logger.debug(`  pattern match: ${match}`);
        //   });
        // });

        async.each(citedPapers, (citedPaper: PaperRow, callback: ErrorCallback) => {
          // prepare the mention searches
          var paperWrapper = new Paper(citedPaper);
          var patterns = paperWrapper.getPatterns();
          // look for them in the paper text
          var occurrences = patterns.map(pattern => countOccurrences(pattern, content));
          var total = occurrences.reduce((a, b) => a + b, 0);
          logger.debug(`  found ${chalk.yellow(total)} instances of ${chalk.green(citedPaper.id)} (${chalk.magenta(paperWrapper.toReference())}) [${chalk.blue(patterns.join(' / '))}]`);

          db.Update('citation')
          .setEqual({count: total})
          .whereEqual({citing_paper_id: article.id, cited_paper_id: citedPaper.id})
          .execute(callback);
        }, error => {
          callback(error, {id: article.id});
        });
      });
    });
  }, {objectMode: true}))
  .pipe(new streaming.json.Stringifier())
  .pipe(process.stdout);
}

if (require.main === module) {
  var anthology_root = '/Volumes/Stephenson/acl-anthology/P/P13';
  logger.level = 'debug'; // info | debug
  db.init(error => {
    if (error) throw error;
    loadLocations(anthology_root, error => {
      if (error) throw error;
      logger.info('DONE');
    });
  });
}
