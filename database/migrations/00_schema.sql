CREATE TABLE paper (
  -- PRIMARY KEY simply evaluates to UNIQUE and NOT NULL
  id TEXT PRIMARY KEY CHECK (id ~ '^\w\d{2}-\d{4}'),

  -- required reference data
  pubtype TEXT NOT NULL,
  year TEXT NOT NULL,
  title TEXT NOT NULL,
  booktitle TEXT NOT NULL,
  -- optional reference data
  address TEXT,
  pages TEXT,
  author TEXT, -- missing for admin-type publications
  month TEXT,
  citekey TEXT,
  publisher TEXT,
  url TEXT,
  doi TEXT
);


CREATE TABLE citation (
  citing_paper_id TEXT NOT NULL REFERENCES paper(id) ON DELETE CASCADE,
  cited_paper_id TEXT NOT NULL REFERENCES paper(id) ON DELETE CASCADE,
  PRIMARY KEY (citing_paper_id, cited_paper_id),

  count INTEGER NOT NULL
);

-- search functionality:

CREATE FUNCTION jointexts(VARIADIC TEXT[]) RETURNS TEXT AS
  $$
  BEGIN
    RETURN array_to_string($1, ' ');
  END
  $$ IMMUTABLE LEAKPROOF LANGUAGE plpgsql;

ALTER TABLE paper ADD COLUMN reference_string TEXT;
UPDATE paper SET reference_string = jointexts(author, year, title, booktitle, pages, publisher);

-- text search index

CREATE INDEX paper_reference_vector_idx ON paper USING gin(to_tsvector('simple', reference_string));

-- trigram index

CREATE EXTENSION pg_trgm;
CREATE INDEX paper_reference_gin_trgm_idx ON paper USING gin(reference_string gin_trgm_ops);
CREATE INDEX paper_reference_gist_trgm_idx ON paper USING gist(reference_string gist_trgm_ops);
