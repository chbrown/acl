/// <reference path="type_declarations/index.d.ts" />
var child_process = require('child_process');
var logger = require('loge');
var streaming = require('streaming');
var pdflib = require('pdf');
pdflib.logger.level = 'debug'; // i.e., just above 'silly'
/**
Run Xpdf's pdftotext (e.g., v3.04) on the given pdf filepath.

other options:
-f <int>             : first page to convert
-l <int>             : last page to convert
-layout              : maintain original physical layout
-table               : similar to -layout, but optimized for tables
-lineprinter         : use strict fixed-pitch/height layout
-raw                 : keep strings in content stream order
-fixed <fp>          : assume fixed-pitch (or tabular) text
-linespacing <fp>    : fixed line spacing for LinePrinter mode
-clip                : separate clipped text
-enc <string>        : output text encoding name
-eol <string>        : output end-of-line convention (unix, dos, or mac)
-nopgbrk             : don't insert page breaks between pages
-opw <string>        : owner password (for encrypted files)
-upw <string>        : user password (for encrypted files)
-q                   : don't print any messages or errors
-cfg <string>        : configuration file to use in place of .xpdfrc

TODO: use opts if specified
TODO: put the result in the given txt filepath if specified
*/
function pdftotext(pdf_filepath, callback) {
    var args = ['-enc', 'UTF-8', pdf_filepath, '-'];
    logger.debug("$ pdftotext " + args.join(' '));
    var child = child_process.spawn('pdftotext', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.on('error', function (error) {
        callback(error);
    });
    var chunks = [];
    child.stdout.on('data', function (chunk) {
        chunks.push(chunk);
    });
    child.stderr.on('data', function (chunk) {
        logger.debug("STDERR[pdftotext] " + chunk.toString());
    });
    child.on('close', function (code, signal) {
        // close comes with the promise that all the stdio streams have been closed
        if (code !== 0) {
            return callback(new Error("Exited with return code " + code + " at signal " + signal));
        }
        var output = Buffer.concat(chunks).toString('utf8');
        callback(null, output);
    });
}
exports.pdftotext = pdftotext;
function extract(pdf_filepath, callback) {
    logger.info("Opening " + pdf_filepath);
    var pdf = pdflib.PDF.open(pdf_filepath);
    var section_names = ['col1', 'col2'];
    var document = pdf.getDocument(section_names);
    var paragraphs = pdflib.Arrays.flatMap(document.getSections(), function (section) {
        var paragraphs = section.getParagraphs();
        var lines = paragraphs.map(function (paragraph) { return paragraph.toString(); });
        return [("#" + section.header)].concat(lines);
    });
    logger.info("Extracted " + paragraphs.length + " paragraphs");
    var body = paragraphs.join('\n');
    setImmediate(function () { return callback(null, body); });
}
exports.extract = extract;
