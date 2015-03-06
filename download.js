/// <reference path="type_declarations/index.d.ts" />
var async = require('async');
var fs = require('fs');
var path = require('path');
var urllib = require('url');
var logger = require('loge');
var _ = require('lodash');
var mkdirp = require('mkdirp');
var request = require('request');
var htmlparser2 = require('htmlparser2');
var DomlikeHandler = require('domlike/handler');
var js_yaml = require('js-yaml');
var redis = require('redis');
function http_cache_get(url, callback) {
    var redis_client = redis.createClient();
    var done = function (err, result) {
        redis_client.quit();
        // escape redis's ugly exception-intercepting clutches
        setImmediate(function () {
            return callback(err, result);
        });
    };
    redis_client.get(url, function (err, cached) {
        if (err)
            return done(err);
        if (cached) {
            logger.debug('Retrieved %s from cache', url);
            return done(null, cached);
        }
        request.get(url, function (err, response, body) {
            if (err)
                return done(err);
            if (response.statusCode != 200) {
                logger.error('Non-200 response', response);
            }
            // expires in 6 hours
            redis_client.setex(url, 6 * 60 * 60, body, function (err) {
                if (err)
                    return done(err);
                logger.debug('Fetched %s from web', url);
                done(null, body);
            });
        });
    });
}
;
var anthology_root = '/Users/chbrown/github/acl-anthology';
function ensureFile(filepath, createFunction, callback) {
    /** if no file exists at `filepath`, call `ifMissingFunction(callback)`
    */
    fs.exists(filepath, function (exists) {
        if (exists) {
            logger.debug('%s already exists', filepath);
            callback();
        }
        else {
            createFunction(callback);
        }
    });
}
function download(url, filepath, callback) {
    /** streams `url` into `filepath`
    */
    var dirpath = path.dirname(filepath);
    mkdirp(dirpath, function (err) {
        if (err)
            return callback(err);
        logger.info('GET %s > %s', url, filepath);
        var req = request.get(url);
        req.on('error', function (err) {
            logger.error('Error downloading %s', url);
            callback(err);
        });
        req.on('response', function (res) {
            if (res.statusCode != 200)
                return callback(new Error('HTTP response != 200'));
            var stream = fs.createWriteStream(filepath);
            req.pipe(stream).on('finish', function () {
                callback();
            });
        });
    });
}
var Hyperlink = (function () {
    function Hyperlink(text, url) {
        this.text = text;
        this.url = url;
    }
    return Hyperlink;
})();
var WebFile = (function () {
    function WebFile(url, filename) {
        this.url = url;
        if (filename) {
            this.filename = filename;
        }
        else {
            var urlObj = urllib.parse(url);
            var path_parts = urlObj.pathname.split('/');
            this.filename = path_parts[path_parts.length - 1];
        }
    }
    return WebFile;
})();
var StoredWebFile = (function () {
    function StoredWebFile(url, filepath) {
        this.url = url;
        this.filepath = filepath;
    }
    return StoredWebFile;
})();
// ACL specific stuff:
var ACLEntry = (function () {
    function ACLEntry(section, author, title, conference_key, pdf, bib) {
        this.section = section;
        this.author = author;
        this.title = title;
        this.conference_key = conference_key;
        this.pdf = pdf;
        this.bib = bib;
    }
    return ACLEntry;
})();
function getACLEntriesFromHtml(html, url, conference_key, callback) {
    /** Parse HTML of ACL page and return list of entries like:
  
        {
          section: '33rd Annual Meeting of the Association for Computational Linguistics',
          author: 'Kevin Knight; Vasileios Hatzivassiloglou',
          title: 'Two-Level, Many-Paths Generation',
          pdf: {
            href: 'P95-1034.pdf',
            text: 'P95-1034.pdf',
          },
          bib: {
            href: 'P95-1034.bib',
            text: 'P95-1034.bib',
          },
        }
  
    The attached urls will be absolute.
    */
    var handler = new DomlikeHandler(function (err, document) {
        if (err)
            return callback(err);
        document.URL = url;
        // console.log(util.inspect(document, {depth: 4, colors: true}));
        var content = document.getElementById('content') || document.getElementsByTagName('body')[0];
        if (content === undefined) {
            return callback(new Error('No #content element could be found'));
        }
        var section = null;
        var entries = [];
        content.children.forEach(function (child) {
            // console.log('child: ' + util.inspect(child, {depth: 5, colors: true}));
            // console.log('child: %j', child);
            if (child.tagName == 'h1') {
                section = child.textContent;
            }
            else if (section !== null) {
                // var a_pdf = child.querySelector('a[href$="pdf"]');
                var pdf_anchor = child.firstDFS(function (node) {
                    return node.tagName == 'a' && (node.attributes.href || '').match(/pdf$/);
                });
                // var a_bib = child.querySelector('a[href$="bib"]');
                var bib_anchor = child.firstDFS(function (node) {
                    return node.tagName == 'a' && (node.attributes.href || '').match(/bib$/);
                });
                var b = child.firstDFS(function (node) {
                    return node.tagName == 'b';
                });
                var i = child.firstDFS(function (node) {
                    return node.tagName == 'i';
                });
                var author = b ? b.textContent : 'NA';
                var title = i ? i.textContent : 'NA';
                var pdf = pdf_anchor ? new WebFile(pdf_anchor.href, pdf_anchor.textContent + '.pdf') : null;
                var bib = bib_anchor ? new WebFile(bib_anchor.href) : null;
                var entry = new ACLEntry(section, author, title, conference_key, pdf, bib);
                entries.push(entry);
            }
        });
        callback(null, entries);
    });
    var parser = new htmlparser2.Parser(handler, { decodeEntities: true });
    parser.write(html);
    parser.end();
}
function downloadEntries(entries, callback) {
    logger.info('Extracting individual files from %d entries', entries.length);
    var files = [];
    entries.forEach(function (entry) {
        if (entry.bib) {
            var bib_filepath = path.join(anthology_root, entry.conference_key, entry.bib.filename);
            files.push(new StoredWebFile(entry.bib.url, bib_filepath));
        }
        if (entry.pdf) {
            var pdf_filepath = path.join(anthology_root, entry.conference_key, entry.pdf.filename);
            files.push(new StoredWebFile(entry.pdf.url, pdf_filepath));
        }
    });
    logger.info('Found %d files', files.length);
    async.reject(files, function (file, callback) {
        fs.exists(file.filepath, function (exists) {
            callback(null, exists);
        });
    }, function (files) {
        logger.info('Downloading %d files', files.length);
        async.eachLimit(files, 1, function (file, callback) {
            download(file.url, file.filepath, function (err) {
                if (err)
                    logger.error('Error downloading %s: %s', file.url, err);
                callback();
            });
        }, callback);
    });
}
function processEntries(entries, callback) {
    /**
    callback: function(Error | null)
    */
    logger.info('Processing %d entries (converting PDFs to TXT)', entries.length);
    // exclude entries with no PDF url
    entries = entries.filter(function (entry) {
        return entry.pdf !== null;
    });
    var anthology_dirpath = path.join(__dirname, 'anthology');
    async.eachLimit(entries, 1, function (entry, callback) {
        var pdf_filename = entry.pdf.url.replace('http://www.aclweb.org/anthology', '');
        var pdf_filepath = path.join(anthology_dirpath, pdf_filename);
        var txt_filepath = pdf_filepath.replace(/.pdf$/, '.txt');
        //{pdf_filepath: pdf_filepath, filepath: txt_filepath}
        ensureFile(txt_filepath, function (callback) {
            //text.extract(callback)
            callback();
        }, function (err) {
            if (err) {
                logger.error('text.extract raised %s; ignoring', err.toString());
            }
            callback();
        });
    }, callback);
}
function downloadConferences(callback) {
    // getAllACLEntries('P', _.range(1979, 2015), function(err, entries)
    var conferences_yaml = fs.readFileSync(path.join(__dirname, 'conferences.yaml'), { encoding: 'utf8' });
    var conferences = js_yaml.load(conferences_yaml);
    var conference_keys = _.flatten(_.values(conferences));
    // conference_keys is something like ['P/P90', 'P/P91', ...]
    // keys = ['D/D02'];
    logger.info('Crawling %d conference keys', conference_keys.length);
    async.mapLimit(conference_keys, 100, function (conference_key, callback) {
        var url = 'http://www.aclweb.org/anthology/' + conference_key + '/';
        // Fetch ACL page (potentially from cache) and return list of entries like:
        logger.info('Fetching: %s', url);
        http_cache_get(url, function (err, html) {
            if (err)
                return callback(err);
            getACLEntriesFromHtml(html, url, conference_key, callback);
        });
    }, function (err, entriess) {
        if (err)
            return callback(err);
        // flatten out over conferences/years
        var entries = _.flatten(entriess);
        logger.info('Found %d entries', entries.length);
        downloadEntries(entries, function (err) {
            if (err)
                return callback(err);
            //processEntries(entries, function(err) { });
            return callback();
        });
        // callback(null, entries);
    });
}
if (require.main === module) {
    // Actually running it:
    logger.level = 'INFO';
    downloadConferences(function (err) {
        if (err)
            throw err;
        logger.info('DONE');
    });
}
