/*jslint node: true */
var async = require('async');
var fs = require('fs');
var path = require('path');
var util = require('util');
var logger = require('loge');
var _ = require('lodash');
var mkdirp = require('mkdirp');
var request = require('request');
var htmlparser2 = require('htmlparser2');
var DomlikeHandler = require('domlike/handler');

var http_cache = require('./http-cache');
var text = require('./text');

var callIfMissing = function(opts, fn, callback) {
  /** if no file exists at `filepath`, call `fn(opts, callback)`
  */
  if (opts.filepath === undefined) throw new Error('"filepath" is a required argument');

  fs.exists(opts.filepath, function(exists) {
    if (exists) {
      logger.debug('%s already exists', opts.filepath);
      callback();
    }
    else {
      fn(opts, callback);
    }
  });
};

var download = function(opts, callback) {
  /** streams `opts.url` into `opts.filepath`

  callback: function(Error | null)
  */
  if (opts.filepath === undefined) throw new Error('"filepath" is a required argument');
  if (opts.url === undefined) throw new Error('"url" is a required argument');

  var dirpath = path.dirname(opts.filepath);
  mkdirp(dirpath, function(err) {
    if (err) return callback(err);

    logger.info('GET %s > %s', opts.url, opts.filepath);
    var stream = fs.createWriteStream(opts.filepath);
    request.get(opts.url).pipe(stream)
    .on('error', function(err) {
      callback(err);
    })
    .on('finish', function() {
      callback();
    });
  });
};


// ACL specific stuff:

var getACLEntriesFromHtml = function(html, callback) {
  /** Parse HTML of ACL page and return list of entries like:

      {
        author: 'Kevin Knight; Vasileios Hatzivassiloglou',
        title: 'Two-Level, Many-Paths Generation',
        pdf_url: 'P95-1034.pdf',
        bib_url: 'P95-1034.bib',
      }

  The returned urls will probably be relative.
  */
  var handler = new DomlikeHandler(function(err, document) {
    if (err) return callback(err);

    // console.log(util.inspect(document, {depth: 4, colors: true}));
    var content = document.getElementById('content');

    if (!content) return callback(new Error('No #content element'));

    var section = null;
    var entries = [];
    _.each(content.children, function(child) {
      // console.log('child', util.inspect(child, {depth: 4, colors: true}));
      if (child.tagName == 'h1') {
        section = child.textContent;
      }
      else if (section !== null) {
        var anchors = child.childNodes.filter(function(node) {
          return node.tagName == 'a';
        });

        // var a_bib = child.querySelector('a[href$="bib"]');
        var a_bib = child.firstDFS(function(node) {
          return node.tagName == 'a' && (node.attributes.href || '').match(/bib$/);
        });
        var bib_url = a_bib ? a_bib.attributes.href : null;

        // var a_pdf = child.querySelector('a[href$="pdf"]');
        var a_pdf = child.firstDFS(function(node) {
          return node.tagName == 'a' && (node.attributes.href || '').match(/pdf$/);
        });
        var pdf_url = a_pdf ? a_pdf.attributes.href : null;

        var b = child.firstDFS(function(node) { return node.tagName == 'b'; });
        var i = child.firstDFS(function(node) { return node.tagName == 'i'; });
        var entry = {
          author: b ? b.textContent : 'NA',
          title: i ? i.textContent : 'NA',
          pdf_url: pdf_url,
          bib_url: bib_url,
        };
        entries.push(entry);
      }
    });

    callback(null, entries);
  });
  var parser = new htmlparser2.Parser(handler, {decodeEntities: true});
  parser.write(html);
  parser.done();
};

var getACLEntriesFromUrl = function(url, callback) {
  /** Fetch ACL page and return list of entries like:

      {
        author: 'Kevin Knight; Vasileios Hatzivassiloglou',
        title: 'Two-Level, Many-Paths Generation',
        pdf_url: 'http://www.aclweb.org/anthology/P/P95-1034.pdf',
        bib_url: 'http://www.aclweb.org/anthology/P/P95-1034.bib',
      }

  The attached urls will be absolute.
  */
  http_cache.get(url, function(err, html) {
    if (err) return callback(err);

    getACLEntriesFromHtml(html, function(err, entries) {
      if (err) {
        logger.info('Error parsing HTML: %s from URL: %s', html, url);
        return callback(err);
      }

      // logger.info('Found %d entries on %s', entries.length, url);

      // absolute-ize the relative urls; ignore null urls
      entries.map(function(entry) {
        if (entry.bib_url) {
          entry.bib_url = url + entry.bib_url;
        }
        if (entry.pdf_url) {
          entry.pdf_url = url + entry.pdf_url;
        }
      });

      callback(null, entries);
    });
  });
};

// Actually running it:

function finalize(err) {
  if (err) throw err;
  logger.info('DONE');
}

logger.level = 'INFO';

var anthology_dirpath = path.join(__dirname, 'anthology');

var getAllACLEntries = function(letter, years, callback) {
  /**
  letter: String - a single letter
      P for ACL
      D for EMNLP
      etc.
  years: Array - an array of integers
  callback: function(Error, list_of_entries)

  P (ACL) has P79 through P14
  */
  var url_root = 'http://www.aclweb.org/anthology/' + letter + '/' + letter;
  async.map(years, function(year, callback) {
    // e.g., http://www.aclweb.org/anthology/P/P95/
    getACLEntriesFromUrl(url_root + year.toString().slice(2) + '/', callback);
  }, function(err, entries) {
    if (err) return callback(err);

    // flatten out over years
    callback(null, _.flatten(entries));
  });
};

var downloadEntries = function(entries, callback) {
  /**
  callback: function(Error | null)
  */
  logger.info('Downloading %d entries', entries.length);

  var files = [];
  entries.forEach(function(entry) {
    if (entry.bib_url) {
      files.push({
        url: entry.bib_url,
        filepath: path.join(anthology_dirpath, entry.bib_url.replace('http://www.aclweb.org/anthology', '')),
      });
    }
    if (entry.pdf_url) {
      files.push({
        url: entry.pdf_url,
        filepath: path.join(anthology_dirpath, entry.pdf_url.replace('http://www.aclweb.org/anthology', '')),
      });
    }
  });

  // files is now an array of {url: 'http://...', filepath: '/...'} objects (both PDF/BIB urls)

  // fetch at most X at a time
  async.eachLimit(files, 1, function(file, callback) {
    callIfMissing(file, download, callback);
  }, callback);
};

var processEntries = function(entries, callback) {
  /**
  callback: function(Error | null)
  */
  logger.info('Processing %d entries (converting PDFs to TXT)', entries.length);

  // exclude entries with no PDF url
  entries = entries.filter(function(entry) {
    return entry.pdf_url;
  });

  async.eachLimit(entries, 1, function(entry, callback) {
    var pdf_filename = entry.pdf_url.replace('http://www.aclweb.org/anthology', '');
    var pdf_filepath = path.join(anthology_dirpath, pdf_filename);
    var txt_filepath = pdf_filepath.replace(/.pdf$/, '.txt');

    callIfMissing({pdf_filepath: pdf_filepath, filepath: txt_filepath}, text.extract, function(err) {
      if (err) {
        logger.error('text.extract raised %s; ignoring', err.toString());
      }
      callback();
    });
  }, callback);
};

var main = function(callback) {
  getAllACLEntries('P', _.range(1979, 2015), function(err, entries) {
    if (err) return callback(err);

    downloadEntries(entries, function(err) {
      if (err) return callback(err);

      processEntries(entries, function(err) {
        return callback(err);
      });
    });
  });
};

main(finalize);
