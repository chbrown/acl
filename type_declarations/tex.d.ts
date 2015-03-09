declare module "tex" {

  export interface ReferenceTag {
    key: string;
    value: string;
  }

  export interface Reference {
    type: string;
    key: string;
    tags: ReferenceTag[];

    toJSON(): any;
  }

  class Bibtex {
    parse(bibtex: string, callback: (error: Error, references: Reference[]) => void): void;
  }

  export var bibtex: Bibtex;
}
