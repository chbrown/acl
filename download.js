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

var anthology_dirpath = path.join(__dirname, 'anthology');

// var readAnthology = function(url) {
  // http://www.aclweb.org/anthology/P/P95/

var getFile = function(url, callback) {
  var filename = url.replace('http://www.aclweb.org/anthology', '');
  var filepath = path.join(anthology_dirpath, filename);
  var dirpath = path.dirname(filepath);
  // logger.debug('Creating directory: %s', dirpath);
  mkdirp(dirpath, function(err) {
    if (err) return callback(err);

    fs.exists(filepath, function(exists) {
      if (exists) {
        logger.debug('Not downloading existing file: %s', filepath);
        callback();
      }
      else {
        logger.info('GET %s > %s', url, filepath);
        var stream = fs.createWriteStream(filepath);
        request.get(url).pipe(stream)
        .on('error', function(err) {
          callback(err);
        })
        .on('finish', function() {
          callback();
        });
      }
    });
  });
};




var getACLEntries = function(url, callback) {
  http_cache.get(url, function(err, html) {
    if (err) return callback(err);

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
          var bib_url = a_bib ? (url + a_bib.attributes.href) : null;

          // var a_pdf = child.querySelector('a[href$="pdf"]');
          var a_pdf = child.firstDFS(function(node) {
            return node.tagName == 'a' && (node.attributes.href || '').match(/pdf$/);
          });
          var pdf_url = a_pdf ? (url + a_pdf.attributes.href) : null;

          var b = child.getElementByTagName('b');
          var i = child.getElementByTagName('i');
          var entry = {
            author: b ? b.textContent : 'NA',
            title: i ? i.textContent : 'NA',
            pdf_url: pdf_url,
            bib_url: bib_url,
          };
          // console.log('entry', entry);
          entries.push(entry);
        }
      });

      callback(null, entries);
    });
    var parser = new htmlparser2.Parser(handler, {decodeEntities: true});
    parser.write(html);
    parser.done();
  });
};


function findAllUrls(callback) {
  // P79 -> P14
  var years = _.range(1996, 2014);
  async.map(years, function(year, callback) {
    // var url = 'http://www.aclweb.org/anthology/P/P' + year.toString().slice(2) + '/'; // ACL
    var url = 'http://www.aclweb.org/anthology/D/D' + year.toString().slice(2) + '/'; // EMNLP

    getACLEntries(url, function(err, entries) {
      if (err) return callback(err);

      logger.info('Downloading %d entries', entries.length);

      var urls = [];
      entries.map(function(entry) {
        urls.push(entry.bib_url, entry.pdf_url);
      });

      callback(null, urls);
    });
  }, function(err, urls) {
    if (err) return callback(err);

    // flatten and filter out null urls
    urls = _.flatten(urls).filter(_.identity);

    callback(null, urls);
  });
}


function finalize(err) {
  if (err) throw err;
  logger.info('DONE');
}

findAllUrls(function(err, urls) {
  async.eachLimit(urls, 20, getFile, finalize);
});
