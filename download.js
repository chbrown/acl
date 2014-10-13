/*jslint node: true */
var async = require('async');
var fs = require('fs');
var path = require('path');
var util = require('util');
var jsdom = require('jsdom');
var logger = require('loge');
var _ = require('lodash');
var mkdirp = require('mkdirp');
var request = require('request');
var htmlparser2 = require('htmlparser2');
var DomlikeHandler = require('domlike/handler');
var http_cache = require('./http-cache');

var downloadFileIfMissing = function(url, filepath, callback) {
  /** if no file exists at `filepath`, streams `url` into filepath

  callback: function(Error | null)
  */
  fs.exists(filepath, function(exists) {
    if (exists) {
      logger.debug('%s already exists', filepath);
      callback();
    }
    else {
      var dirpath = path.dirname(filepath);
      mkdirp(dirpath, function(err) {
        if (err) return callback(err);

        logger.info('GET %s > %s', url, filepath);
        var stream = fs.createWriteStream(filepath);
        request.get(url).pipe(stream)
        .on('error', function(err) {
          callback(err);
        })
        .on('finish', function() {
          callback();
        });
      });
    }
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

    // console.log(util.inspect(document, {depth: 12, colors: true}));
    var content = document.getElementById('content');

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

        var b = child.getElementByTagName('b');
        var i = child.getElementByTagName('i');
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
  http_cache.get(url, function(err, html) {
    if (err) return callback(err);

    getACLEntriesFromHtml(html, function(err, entries) {
      if (err) return callback(err);

      logger.info('Downloading %d entries', entries.length);

      var urls = [];
      entries.map(function(entry) {
        // absolute-ize the relative urls; ignore null urls
        if (entry.bib_url) {
          urls.push(url + entry.bib_url);
        }
        if (entry.pdf_url) {
          urls.push(url + entry.pdf_url);
        }
      });

      callback(null, urls);
    });
  });
};

// Actually running it:

function finalize(err) {
  if (err) throw err;
  logger.info('DONE');
}

logger.level = 'DEBUG';

var anthology_dirpath = path.join(__dirname, 'anthology');

var main = function(callback) {
  // function findAllUrls(journal, years, callback) {
  /**
  journal: String - a single letter
      P for ACL
      D for EMNLP
      etc.
  years: Array - an array of integers
  callback: function(Error, list_of_urls)

  P (ACL) has P79 through P14
  */
  var journal = 'P';
  var years = _.range(1996, 2014);
  async.map(years, function(year, callback) {
    // e.g., http://www.aclweb.org/anthology/P/P95/
    var url = 'http://www.aclweb.org/anthology/' + journal + '/' + journal + year.toString().slice(2) + '/';

    getACLEntriesFromUrl(url, callback);
  }, function(err, entry_urls) {
    if (err) return callback(err);

    // flatten out urls
    entry_urls = _.flatten(entry_urls);

    logger.info('Downloading %d entries (PDF/BIB urls)', entry_urls.length);

    // fetch at most 20 at a time
    async.eachLimit(entry_urls, 20, function(entry_url, callback) {
      var filename = entry_url.replace('http://www.aclweb.org/anthology', '');
      var filepath = path.join(anthology_dirpath, filename);
      downloadFileIfMissing(entry_url, filepath, callback);
    }, callback);
  });
};

main(finalize);
