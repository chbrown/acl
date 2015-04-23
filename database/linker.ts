/// <reference path="../type_declarations/index.d.ts" />
import * as _ from 'lodash';
import * as async from 'async';
import * as chalk from 'chalk';
import * as logger from 'loge';

import {Article, Paper, PaperRow} from '../models';
import {File} from '../common';

var streaming = require('streaming');
var db = require('./db');

function resolveReferenceParagraph(referenceParagraph: string,
                                   callback: ErrorResultCallback<PaperRow>) {
  var select = db.Select('paper')
  .add('*', 'reference_string <-> $QUERY AS distance')
  .where('reference_string % $QUERY')
  .where('reference_string <-> $QUERY < 0.65')
  .orderBy('reference_string <-> $QUERY')
  .limit(1);

  select.parameters.QUERY = referenceParagraph;

  select.execute((error: Error, rows: PaperRow[]) => {
    if (error) return callback(error);

    callback(null, rows[0]); // rows[0] may be undefined
  });
}

/**
loadCitations iterates through all PDFs in the given directory (recursively), and:

1. parses each one
2. separates the reference paragraphs
3. resolves each reference plaintext to some paper in the database
*/
function loadCitations(root: string, callback: ErrorCallback) {
  Article.stream(root).pipe(new streaming.Transformer((article: Article, encoding: string, callback: ErrorResultCallback<any>) => {
    article.getParagraphs((error: Error, paragraphs: string[]) => {
      var references_index = paragraphs.indexOf('#References');
      if (references_index > -1) {
        var referenceParagraphs = paragraphs.slice(references_index + 1);
        logger.info(`found ${chalk.green('#References')} at paragraph ${references_index} / ${paragraphs.length} (N=${referenceParagraphs.length})`);

        async.map(referenceParagraphs, resolveReferenceParagraph, (error, resolvedPapers: PaperRow[]) => {
          if (error) return callback(error);

          resolvedPapers.forEach((resolvedPaper, i) => {
            var matchString = resolvedPaper ? new Paper(resolvedPaper).toReference() : 'N/A';
            var matchDistance = resolvedPaper ? resolvedPaper['distance'] : '';
            logger.debug(`  "${chalk.yellow(referenceParagraphs[i])}" -> ${chalk.green(matchString)} ${chalk.magenta(matchDistance)}`);
          });

          // filter out the null resolved papers (no match)
          var citedPapers = resolvedPapers.filter(paper => !!paper);
          // insert all the resolved matches as citations
          async.each(citedPapers, (citedPaper: PaperRow, callback: ErrorCallback) => {
            db.Insert('citation')
            .set({
              citing_paper_id: article.id,
              cited_paper_id: citedPaper.id,
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
            callback(null, {citing_paper_id: article.id, cited_papers_ids: citedPapers.map(paper => paper.id)});
          });
        });
      }
      else {
        logger.info(`${chalk.red('found no "#References" paragraph')}`);
        callback(null, {error: 'No "#References" paragraph detected', id: article.id});
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
