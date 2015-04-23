var async = require('async');
var chalk = require('chalk');
var logger = require('loge');
var models_1 = require('../models');
var streaming = require('streaming');
var db = require('./db');
var punctuation = /[,.:!'"()&]/g;
function resolveReferenceParagraph(referenceParagraph, callback) {
    var select = db.Select('paper')
        .add('*', 'reference_string <-> $QUERY AS distance')
        .where('reference_string % $QUERY')
        .where('reference_string <-> $QUERY < 0.65')
        .orderBy('reference_string <-> $QUERY')
        .limit(1);
    select.parameters.QUERY = referenceParagraph;
    select.execute(function (error, rows) {
        if (error)
            return callback(error);
        callback(null, rows[0]); // rows[0] may be undefined
    });
}
/**
loadCitations iterates through all PDFs in the given directory (recursively), and:

1. parses each one
2. separates the reference paragraphs
3. resolves each reference plaintext to some paper in the database
*/
function loadCitations(root, callback) {
    models_1.Article.stream(root).pipe(new streaming.Transformer(function (article, encoding, callback) {
        article.getParagraphs(function (error, paragraphs) {
            var references_index = paragraphs.indexOf('#References');
            if (references_index > -1) {
                var referenceParagraphs = paragraphs.slice(references_index + 1);
                logger.info("found " + chalk.green('#References') + " at paragraph " + references_index + " / " + paragraphs.length + " (N=" + referenceParagraphs.length + ")");
                async.map(referenceParagraphs, resolveReferenceParagraph, function (error, resolvedPapers) {
                    if (error)
                        return callback(error);
                    resolvedPapers.forEach(function (resolvedPaper, i) {
                        var matchString = resolvedPaper ? new models_1.Paper(resolvedPaper).toReference() : 'N/A';
                        var matchDistance = resolvedPaper ? resolvedPaper['distance'] : '';
                        logger.debug("  \"" + chalk.yellow(referenceParagraphs[i]) + "\" -> " + chalk.green(matchString) + " " + chalk.magenta(matchDistance));
                    });
                    // filter out the null resolved papers (no match)
                    var citedPapers = resolvedPapers.filter(function (paper) { return !!paper; });
                    // insert all the resolved matches as citations
                    async.each(citedPapers, function (citedPaper, callback) {
                        db.Insert('citation')
                            .set({
                            citing_paper_id: article.id,
                            cited_paper_id: citedPaper.id,
                        })
                            .execute(function (error) {
                            // ignore unique constraint violations
                            if (error && error.code === '23505') {
                                return callback(null);
                            }
                            return callback(error);
                        });
                    }, function (error) {
                        if (error)
                            return callback(error);
                        callback(null, { citing_paper_id: article.id, cited_papers_ids: citedPapers.map(function (paper) { return paper.id; }) });
                    });
                });
            }
            else {
                logger.info("" + chalk.red('found no "#References" paragraph'));
                callback(null, { error: 'No "#References" paragraph detected', id: article.id });
            }
        });
    }, { objectMode: true }))
        .pipe(new streaming.json.Stringifier())
        .pipe(process.stdout);
}
if (require.main === module) {
    var anthology_root = '/Volumes/Stephenson/acl-anthology/P/P13';
    logger.level = 'info'; // info | debug
    db.init(function (error) {
        if (error)
            throw error;
        loadCitations(anthology_root, function (error) {
            if (error)
                throw error;
            logger.info('DONE');
        });
    });
}
