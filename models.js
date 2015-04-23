/// <reference path="type_declarations/index.d.ts" />
var fs = require('fs');
var path = require('path');
var tex = require('tex');
var unorm = require('unorm');
var logger = require('loge');
var text = require('./text');
var streaming = require('streaming');
function getLastName(name) {
    var comma = name.indexOf(',');
    if (comma > -1) {
        return name.slice(0, comma);
    }
    var parts = name.split(/\s+/);
    return parts[parts.length - 1];
}
var Paper = (function () {
    function Paper(paper) {
        this.paper = paper;
    }
    /**
    names can vary a lot;
  
    1: Maxwell
    2: Bendersky
       Bendersky and Croft
       Bendersky et al.
    3. Shen
       Shen et al.
  
    (Song et al., 2008)
    Lin and Pantel (2001)
    */
    Paper.prototype.getPatterns = function () {
        var year = this.paper.year;
        var lastNames = (this.paper.author || '').split(/\s+and\s+/).map(getLastName);
        var names = [lastNames[0]];
        if (lastNames.length > 1) {
            names.push(lastNames[0] + " et al.");
        }
        if (lastNames.length === 2) {
            names.push(lastNames[0] + " and " + lastNames[1]);
        }
        var patternss = names.map(function (name) {
            // "Brown, 2015" & "Brown (2015)"
            return [(name + ", " + year), (name + " (" + year + ")")].map(unorm.nfc);
        });
        return Array.prototype.concat.apply([], patternss);
    };
    Paper.prototype.authorString = function () {
        var names = (this.paper.author || '').split(/\s+and\s+/).map(function (author) { return author.split(',').reverse().join(' ').trim(); });
        if (names.length < 3) {
            return names.join(' and ');
        }
        // use the Oxford comma
        var parts = names.slice(0, -2); // maybe be []
        parts.push(names.slice(-2).join(', and '));
        return parts.join(', ');
    };
    /**
    TODO: make this actually match the typical ACL style bst output.
    */
    Paper.prototype.toReference = function () {
        return this.authorString() + ". " + this.paper.year + ". " + this.paper.title + ". " + this.paper.booktitle + ", " + this.paper.pages + ".";
    };
    return Paper;
})();
exports.Paper = Paper;
/**
Article is a representation of a PDF, its text, a BibTeX reference, and its JSON.

It's built from a single `filepattern` string that contains all of the filepath
except for the extension, and assumes that `${filepattern}.pdf` and
`${filepattern}.bib` exist.

E.g.: "/Volumes/Stephenson/acl-anthology/W/W12/W12-0911"
*/
var Article = (function () {
    function Article(filepattern) {
        this.filepattern = filepattern;
    }
    Object.defineProperty(Article.prototype, "id", {
        get: function () { return path.basename(this.filepattern); },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(Article.prototype, "bib_filepath", {
        get: function () { return this.filepattern + '.bib'; },
        enumerable: true,
        configurable: true
    });
    ;
    Object.defineProperty(Article.prototype, "reference_filepath", {
        get: function () { return this.filepattern + '.json'; },
        enumerable: true,
        configurable: true
    });
    ;
    Object.defineProperty(Article.prototype, "pdf_filepath", {
        get: function () { return this.filepattern + '.pdf'; },
        enumerable: true,
        configurable: true
    });
    ;
    Object.defineProperty(Article.prototype, "text_filepath", {
        get: function () { return this.filepattern + '.txt'; },
        enumerable: true,
        configurable: true
    });
    ;
    Article.prototype.getReference = function (callback) {
        var _this = this;
        fs.readFile(this.reference_filepath, { encoding: 'utf8' }, function (error, reference_json) {
            if (error) {
                logger.debug("getReference fs.readFile error; converting .bib to .json"); // ${error['stack']}
                return fs.readFile(_this.bib_filepath, { encoding: 'utf8' }, function (error, bibtex_string) {
                    if (error) {
                        return callback(error);
                    }
                    var references;
                    try {
                        // do not callback() from inside a try { }
                        references = tex.bib.parseReferences(bibtex_string);
                    }
                    catch (exc) {
                        logger.error("Failed while parsing Reference in " + _this.bib_filepath);
                        return callback(exc);
                    }
                    // check that we parsed exactly one reference
                    if (references.length === 0) {
                        return callback(new Error("No References in file: " + _this.bib_filepath));
                    }
                    if (references.length !== 1) {
                        return callback(new Error("Too many References (" + references.length + ") in file: " + _this.bib_filepath));
                    }
                    var reference = references[0];
                    var reference_json = JSON.stringify(reference);
                    fs.writeFile(_this.reference_filepath, reference_json + '\n', { encoding: 'utf8' }, function (error) {
                        if (error)
                            return callback(error);
                        callback(null, reference);
                    });
                });
            }
            callback(null, JSON.parse(reference_json));
        });
    };
    Article.prototype.getParagraphs = function (callback) {
        var _this = this;
        fs.readFile(this.text_filepath, { encoding: 'utf8' }, function (error, text_content) {
            if (error) {
                logger.debug("getParagraphs fs.readFile error; converting .pdf to .txt");
                var paragraphs = text.extract(_this.pdf_filepath);
                var paragraphs_string = paragraphs.join('\n');
                return fs.writeFile(_this.text_filepath, paragraphs_string + '\n', { encoding: 'utf8' }, function (error) {
                    if (error)
                        return callback(error);
                    callback(null, paragraphs);
                });
            }
            callback(null, text_content.trim().split(/\n/));
        });
    };
    Article.stream = function (root) {
        var transform = function (file, encoding, callback) {
            // suppose file.path == /Volumes/External/acl-anthology/W/W12/W12-0911.pdf
            var pdf_match = file.path.match(/\/(\w\d{2}-\d{4}).pdf$/);
            if (pdf_match === null) {
                return callback();
            }
            var filepattern = file.path.replace(/\.pdf$/, '');
            var article = new Article(filepattern);
            fs.exists(article.bib_filepath, function (exists) {
                if (!exists) {
                    // skip pdfs that do not have an accompanying Bibfile
                    return callback();
                }
                callback(null, article);
            });
        };
        return new streaming.Walk(root).pipe(new streaming.Transformer(transform, { objectMode: true }));
    };
    return Article;
})();
exports.Article = Article;
