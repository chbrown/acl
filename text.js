/// <reference path="types/all.d.ts" />
var child_process = require('child_process');
var logger = require('loge');
function extract(pdf_filepath, txt_filepath, opts, callback) {
    /** Run out-of-the-box pdftotext (e.g., v3.04) on the given pdf filepath,
    putting the result in the given txt filepath.
  
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
    */
    // TODO: use opts if specified
    child_process.spawn('pdftotext', [pdf_filepath, txt_filepath, '-enc', 'UTF-8'], {
        stdio: ['ignore', 'pipe', 'pipe']
    }).on('error', function (err) {
        callback(err);
    }).on('exit', function (code, signal) {
        logger.info('pdftotext %s > %s', pdf_filepath, txt_filepath);
        callback(code === 0 ? null : new Error('Exited with return code ' + code + ' at signal ' + signal));
    });
}
exports.extract = extract;
