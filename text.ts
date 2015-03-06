/// <reference path="type_declarations/index.d.ts" />

import child_process = require('child_process');
import logger = require('loge');

export interface ExtractOptions {
  f: number;
  l: number;
  layout: boolean;
  table: boolean;
  lineprinter: boolean;
  raw: boolean;
  fixed: number;
  linespacing: number;
  clip: boolean;
  enc: string;
  eol: string;
  nopgbrk: boolean;
  opw: string;
  upw: string;
  q: boolean;
  cfg: string;
}

export function extract(pdf_filepath: string, txt_filepath: string, opts: ExtractOptions, callback: (error: Error) => void) {
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
    stdio: ['ignore', 'pipe', 'pipe'],
    // env: process.env // the default anyway
  }).on('error', function(err: Error) {
    callback(err);
  }).on('exit', function(code, signal) {
    logger.info('pdftotext %s > %s', pdf_filepath, txt_filepath);
    callback(code === 0 ? null : new Error('Exited with return code ' + code + ' at signal ' + signal));
  });
}
