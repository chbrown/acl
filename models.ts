/// <reference path="type_declarations/index.d.ts" />
import * as fs from 'fs';
import * as path from 'path';
import * as stream from 'stream';
import * as tex from 'tex';
import * as unorm from 'unorm';
import * as logger from 'loge';

import * as text from './text';
import {File} from './common';

var streaming = require('streaming');

// interface (partially) matching the `paper` table in the PostgreSQL database
export interface PaperRow {
  id: number;
  // reference data:
  pubtype: string;
  year: string;
  title: string;
  booktitle: string;
  author?: string;
  citekey?: string;
  pages?: string;
}

function getLastName(name: string): string {
  var comma = name.indexOf(',');
  if (comma > -1) {
    return name.slice(0, comma);
  }
  var parts = name.split(/\s+/);
  return parts[parts.length - 1];
}

export class Paper {
  constructor(private paper: PaperRow) { }
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
  getPatterns(): string[] {
    var year = this.paper.year;
    var lastNames = (this.paper.author || '').split(/\s+and\s+/).map(getLastName);
    var names = [lastNames[0]];
    if (lastNames.length > 1) {
      names.push(`${lastNames[0]} et al.`);
    }
    if (lastNames.length === 2) {
      names.push(`${lastNames[0]} and ${lastNames[1]}`);
    }

    var patternss = names.map(name => {
      // "Brown, 2015" & "Brown (2015)"
      return [`${name}, ${year}`, `${name} (${year})`].map(unorm.nfc);
    });
    return Array.prototype.concat.apply([], patternss);
  }

  authorString() {
    var names = (this.paper.author || '').split(/\s+and\s+/).map(author => author.split(',').reverse().join(' ').trim());
    if (names.length < 3) {
      return names.join(' and ');
    }
    // use the Oxford comma
    var parts = names.slice(0, -2); // maybe be []
    parts.push(names.slice(-2).join(', and '));
    return parts.join(', ');
  }

  /**
  TODO: make this actually match the typical ACL style bst output.
  */
  toReference(): string {
    return `${this.authorString()}. ${this.paper.year}. ${this.paper.title}. ${this.paper.booktitle}, ${this.paper.pages}.`;
  }
}


/**
Article is a representation of a PDF, its text, a BibTeX reference, and its JSON.

It's built from a single `filepattern` string that contains all of the filepath
except for the extension, and assumes that `${filepattern}.pdf` and
`${filepattern}.bib` exist.

E.g.: "/Volumes/Stephenson/acl-anthology/W/W12/W12-0911"
*/
export class Article {
  constructor(public filepattern: string) { }

  get id() { return path.basename(this.filepattern); }
  get bib_filepath()       { return this.filepattern + '.bib'; };
  get reference_filepath() { return this.filepattern + '.json'; };
  get pdf_filepath()       { return this.filepattern + '.pdf'; };
  get text_filepath()      { return this.filepattern + '.txt'; };

  getReference(callback: (error: Error, reference?: tex.bib.Reference) => void) {
    fs.readFile(this.reference_filepath, {encoding: 'utf8'}, (error: Error, reference_json: string) => {
      if (error) {
        logger.debug(`getReference fs.readFile error; converting .bib to .json`); // ${error['stack']}
        return fs.readFile(this.bib_filepath, {encoding: 'utf8'}, (error: Error, bibtex_string: string) => {
          if (error) {
            return callback(error);
          }
          var references: tex.bib.Reference[];
          try {
            // do not callback() from inside a try { }
            references = tex.bib.parseReferences(bibtex_string);
          }
          catch (exc) {
            logger.error(`Failed while parsing Reference in ${this.bib_filepath}`);
            return callback(exc);
          }

          // check that we parsed exactly one reference
          if (references.length === 0) {
            return callback(new Error(`No References in file: ${this.bib_filepath}`));
          }
          if (references.length !== 1) {
            return callback(new Error(`Too many References (${references.length}) in file: ${this.bib_filepath}`));
          }
          var reference = references[0];
          var reference_json = JSON.stringify(reference);
          fs.writeFile(this.reference_filepath, reference_json + '\n', {encoding: 'utf8'}, (error: Error) => {
            if (error) return callback(error);
            callback(null, reference);
          });
        });
      }
      callback(null, JSON.parse(reference_json))
    });
  }

  getParagraphs(callback: (error: Error, paragraphs?: string[]) => void) {
    fs.readFile(this.text_filepath, {encoding: 'utf8'}, (error: Error, text_content: string) => {
      if (error) {
        logger.debug(`getParagraphs fs.readFile error; converting .pdf to .txt`);
        var paragraphs = text.extract(this.pdf_filepath);
        var paragraphs_string = paragraphs.join('\n');
        return fs.writeFile(this.text_filepath, paragraphs_string + '\n', {encoding: 'utf8'}, (error: Error) => {
          if (error) return callback(error);
          callback(null, paragraphs);
        });
      }
      callback(null, text_content.trim().split(/\n/));
    });
  }

  static stream(root: string): stream.Readable {
    let transform = (file: File, encoding: string, callback: ErrorResultCallback<Article>) => {
      // suppose file.path == /Volumes/External/acl-anthology/W/W12/W12-0911.pdf
      let pdf_match = file.path.match(/\/(\w\d{2}-\d{4}).pdf$/)
      if (pdf_match === null) {
        return callback();
      }
      let filepattern = file.path.replace(/\.pdf$/, '');
      let article = new Article(filepattern);
      fs.exists(article.bib_filepath, exists => {
        if (!exists) {
          // skip pdfs that do not have an accompanying Bibfile
          return callback();
        }
        callback(null, article);
      });
    };

    return new streaming.Walk(root).pipe(new streaming.Transformer(transform, {objectMode: true}));
  }
}
