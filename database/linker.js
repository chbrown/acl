var async = require('async');
var chalk = require('chalk');
var logger = require('loge');
var text = require('../text');
var streaming = require('streaming');
var db = require('./db');
var punctuation = /[,.:!'"()&]/g;
function resolveReferenceParagraph(referenceParagraph, callback) {
    var select = db.Select('paper')
        .where('reference_string % $QUERY')
        .orderBy('reference_string <-> $QUERY')
        .limit(1);
    select.parameters.QUERY = referenceParagraph;
    select.execute(function (error, rows) {
        if (error)
            return callback(error);
        if (rows.length === 0) {
            logger.info("Found no papers matching " + chalk.red(referenceParagraph));
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
function loadCitations(root, callback) {
    new streaming.Walk(root)
        .pipe(new streaming.Transformer(function (file, encoding, callback) {
        var path_match = file.path.match(/\/(\w\d{2}-\d{4}).pdf$/);
        // reject non-pdfs
        if (path_match === null) {
            return callback();
        }
        var id = path_match[1];
        // Given a pdf's filepath, read it, parse it, and return the paragraphs as strings
        logger.info("extracting text from " + chalk.cyan(file.path));
        text.extract(file.path, function (error, pdf_text) {
            if (error)
                return callback(error);
            var pdf_paragraphs = pdf_text.split(/\n/);
            logger.info("extracted " + pdf_text.length + " characters from " + file.path);
            var references_index = pdf_paragraphs.indexOf('#References');
            if (references_index > -1) {
                var referenceParagraphs = pdf_paragraphs.slice(references_index + 1);
                logger.info("found " + chalk.green('#References') + " at paragraph " + references_index + " / " + pdf_paragraphs.length + " (N=" + referenceParagraphs.length + ")");
                // referenceParagraphs.forEach(paragraph => {
                //   logger.info(`>> ${chalk.magenta(paragraph)}`);
                // });
                async.map(referenceParagraphs, resolveReferenceParagraph, function (error, papers) {
                    if (error)
                        return callback(error);
                    // filter out the null resolved papers (no match)
                    papers = papers.filter(function (paper) { return !!paper; });
                    logger.info("Resolved " + chalk.yellow(papers.length) + " out of " + chalk.yellow(referenceParagraphs.length) + " references");
                    // insert all the resolved matches as citations
                    async.each(papers, function (cited_paper, callback) {
                        db.Insert('citation')
                            .set({
                            citing_paper_id: id,
                            cited_paper_id: cited_paper.id,
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
                        callback(null, { citing_paper_id: id, cited_papers_ids: papers.map(function (paper) { return paper.id; }) });
                    });
                });
            }
            else {
                logger.info("" + chalk.red('found no "#References" paragraph'));
                callback(null, { error: 'No "#References" paragraph detected', id: id });
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
