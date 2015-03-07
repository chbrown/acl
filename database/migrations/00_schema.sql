CREATE TABLE paper (
  id SERIAL PRIMARY KEY,

  filebase TEXT UNIQUE NOT NULL,

  text TEXT NOT NULL,
  reference JSON NOT NULL,

  created TIMESTAMP WITH TIME ZONE DEFAULT current_timestamp NOT NULL
);
