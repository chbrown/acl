/// <reference path="types/all.d.ts" />
var fs = require('fs');
var streaming = require('streaming');
var logger = require('loge');
var request = require('request');
var tex = require('tex');
var bibtex = tex.bibtex;
var anthology_root = '/Users/chbrown/github/acl-anthology';
function addReference(reference, callback) {
    //logger.info('adding reference: @%s: %s', reference.type, reference.key);
    request.put({
        url: 'http://localhost:9200/acl/reference/' + reference.key,
        body: JSON.stringify(reference.toJSON()),
        json: true
    }, function (err, res, body) {
        callback(err, body);
    });
}
// var index = 'acl';
// var type = 'reference';
function main(callback) {
    /** walks through all ./anthology/.../P##-####.bib files
    Parses them and adds them to the local elasticsearch server,
    using the given citekey as the document's _id
    */
    new streaming.Walk(anthology_root).pipe(new streaming.Filter(function (file) {
        // file has .path and .stats properties
        return file.path.match(/\/\w\d{2}-\d{4}.bib$/); // && node.stats.isFile();
    })).pipe(new streaming.Queue(10, function (file, callback) {
        fs.readFile(file.path, { encoding: 'utf8' }, function (err, bibtex_string) {
            if (err)
                return callback(err);
            bibtex.parse(bibtex_string, function (err, references) {
                if (err)
                    return callback(err);
                if (references.length === 0) {
                    logger.error('No references in file: %s', file.path);
                    return callback(null, { error: true });
                }
                if (references.length !== 1) {
                    logger.error('Too many references in file: %s', file.path);
                    return callback(null, { error: true });
                }
                var reference = references[0];
                addReference(reference, function (err, body) {
                    if (err)
                        return callback(err);
                    callback(null, { reference: reference, response: body });
                });
            });
        });
    })).pipe(new streaming.json.Stringifier()).pipe(process.stdout);
}
if (require.main === module) {
    main(function (err) {
        if (err)
            throw err;
        logger.info('DONE');
    });
}
