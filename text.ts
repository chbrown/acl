/// <reference path="type_declarations/index.d.ts" />
import child_process = require('child_process');
import logger = require('loge');
var streaming = require('streaming');

var pdfi = require('pdfi');
pdfi.logger.level = 'warn';


interface ExtractOptions {
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
export function pdftotext(pdf_filepath: string,
                          callback: (error: Error, output?: string) => void) {
  var args = ['-enc', 'UTF-8', pdf_filepath, '-'];
  logger.debug(`$ pdftotext ${args.join(' ')}`);
  var child = child_process.spawn('pdftotext', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  child.on('error', (error: Error) => {
    callback(error);
  });

  var chunks = [];
  child.stdout.on('data', (chunk) => {
    chunks.push(chunk);
  });

  child.stderr.on('data', (chunk) => {
    logger.debug(`STDERR[pdftotext] ${chunk.toString()}`);
  });

  child.on('close', (code, signal) => {
    // close comes with the promise that all the stdio streams have been closed
    if (code !== 0) {
      return callback(new Error(`Exited with return code ${code} at signal ${signal}`));
    }

    var output = Buffer.concat(chunks).toString('utf8');
    callback(null, output);
  });
}

/**
Open the file with the pdf library, extract the text from col1 and col2,
and return the paragraphs as an Array of strings.
*/
export function extract(filepath: string): string[] {
  var pdf = pdfi.PDF.open(filepath);
  var document = pdf.getDocument(['col1', 'col2']);

  var paragraphs = pdfi.Arrays.flatMap(document.getSections(), section => {
    var paragraphs = section.getParagraphs();
    var lines = paragraphs.map(paragraph => paragraph.toString());
    return [`#${section.header}`].concat(lines);
  });

  return paragraphs;
}
