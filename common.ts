/// <reference path="type_declarations/index.d.ts" />
import {Stats} from 'fs';

export interface File {
  path: string;
  stats: Stats;
}

export function countOccurrences(needle: string, haystack: string) {
  var occurrences = 0;
  var cursor = 0;
  while (1) {
    cursor = haystack.indexOf(needle, cursor);
    if (cursor == -1) {
      break;
    }
    occurrences++;
    cursor++;
  }
  return occurrences;
}
