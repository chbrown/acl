/// <reference path="../type_declarations/index.d.ts" />
import _ = require('lodash');
import * as logger from 'loge';
import * as tex from 'tex';

import {Article} from '../models';

var streaming = require('streaming');
var db = require('./db');

/**
loadPapers reads through the given directory recursively, adding every
???-????.bib file (i.e., not the ???-?.bib compilations) to the `papers` table.
*/
function loadBibfiles(root: string, callback: ErrorCallback) {
  Article.stream(root).pipe(new streaming.Transformer((article: Article, encoding: string, callback: ErrorResultCallback<any>) => {
    article.getReference((error: Error, reference: tex.bib.Reference) => {
      logger.debug(`read reference from ${article.bib_filepath}: @${reference.pubtype}{${reference.citekey}, ...}`);

      var columns = ['pubtype', 'year', 'title', 'address', 'booktitle', 'pages', 'author', 'month', 'citekey', 'publisher', 'url', 'doi'];
      var paper = _.pick(reference.toJSON(), columns);
      paper['id'] = article.id;

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
