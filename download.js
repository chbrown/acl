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
var js_yaml = require('js-yaml');

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

    var req = request.get(opts.url)
    .on('error', function(err) {
      logger.error('Error downloading %s (skipping)', opts.url);
      callback();
    });

    var stream = fs.createWriteStream(opts.filepath);
    req.pipe(stream)
    .on('finish', function() {
      callback();
    });
  });
};


// ACL specific stuff:

var getACLEntriesFromHtml = function(html, url, callback) {
  /** Parse HTML of ACL page and return list of entries like:

      {
        author: 'Kevin Knight; Vasileios Hatzivassiloglou',
        title: 'Two-Level, Many-Paths Generation',
        pdf_url: 'http://www.aclweb.org/anthology/P/P95-1034.pdf',
        bib_url: 'http://www.aclweb.org/anthology/P/P95-1034.bib',
      }

  The attached urls will be absolute.
  */
  var handler = new DomlikeHandler(function(err, document) {
    if (err) return callback(err);

    // console.log(util.inspect(document, {depth: 4, colors: true}));
    var content = document.getElementById('content') || document.getElementsByTagName('body')[0];

    if (content === undefined) {
      return callback(new Error('No #content element on ' + url));
    }

    var section = null;
    var entries = [];
    _.each(content.children, function(child) {
      // console.log('child: ' + util.inspect(child, {depth: 5, colors: true}));
      // console.log('child: %j', child);
      if (child.tagName == 'h1') {
        section = child.textContent;
        // console.error('section: %s', section);
      }
      else if (section !== null) {
        var anchors = child.childNodes.filter(function(node) {
          return node.tagName == 'a';
        });

        // var a_pdf = child.querySelector('a[href$="pdf"]');
        var a_pdf = child.firstDFS(function(node) {
          return node.tagName == 'a' && (node.attributes.href || '').match(/pdf$/);
        });
        var pdf_url = a_pdf ? a_pdf.attributes.href : null;

        // var a_bib = child.querySelector('a[href$="bib"]');
        var a_bib = child.firstDFS(function(node) {
          return node.tagName == 'a' && (node.attributes.href || '').match(/bib$/);
        });
        var bib_url = a_bib ? a_bib.attributes.href : null;

        var b = child.firstDFS(function(node) { return node.tagName == 'b'; });
        var i = child.firstDFS(function(node) { return node.tagName == 'i'; });
        // absolute-ize the relative urls; ignore null urls
        var entry = {
          author: b ? b.textContent : 'NA',
          title: i ? i.textContent : 'NA',
          pdf_url: pdf_url ? url + pdf_url : pdf_url,
          bib_url: bib_url ? url + bib_url : bib_url,
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

// Actually running it:

function finalize(err) {
  if (err) throw err;
  logger.info('DONE');
}

logger.level = 'INFO';

var anthology_dirpath = path.join(__dirname, 'anthology');

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
  async.eachLimit(files, 5, function(file, callback) {
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
  // getAllACLEntries('P', _.range(1979, 2015), function(err, entries)
  var conferences_yaml = fs.readFileSync(path.join(__dirname, 'conferences.yaml'));
  var conferences = js_yaml.load(conferences_yaml);
  var keys = _(conferences).values().flatten().value();

  // keys = ['D/D02'];
  logger.info('Crawling %d keys', keys.length);

  async.mapLimit(keys, 100, function(key, callback) {
    var url = 'http://www.aclweb.org/anthology/' + key + '/';
    // Fetch ACL page (potentially from cache) and return list of entries like:
    logger.info('Fetching: %s', url);
    http_cache.get(url, function(err, html) {
      if (err) return callback(err);

      getACLEntriesFromHtml(html, url, callback);
    });
  }, function(err, keys_entries) {
    if (err) return callback(err);


    // flatten out over conferences/years
    var entries = _.flatten(keys_entries);
    // console.log(entries);

    logger.info('Found %d entries', entries.length);

    downloadEntries(entries, function(err) {
      if (err) return callback(err);

      processEntries(entries, function(err) {
        return callback(err);
      });
    });

    // callback(null, entries);
  });
};


main(finalize);
