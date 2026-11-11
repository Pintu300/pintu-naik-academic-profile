// Append migrations; never edit SQL already applied to a database.
module.exports = [{
  version: 1,
  sql: `
    CREATE TABLE portfolio.users (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      email text NOT NULL CHECK(char_length(email) BETWEEN 3 AND 254),
      display_name text NOT NULL CHECK(char_length(btrim(display_name)) BETWEEN 1 AND 120),
      password_hash text NOT NULL CHECK(char_length(password_hash) BETWEEN 1 AND 1024),
      created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX users_email_unique ON portfolio.users(lower(email));
    CREATE TABLE portfolio.comments (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id bigint NOT NULL REFERENCES portfolio.users(id) ON DELETE CASCADE,
      resource_slug text NOT NULL CHECK(char_length(btrim(resource_slug)) BETWEEN 1 AND 200),
      body text NOT NULL CHECK(char_length(btrim(body)) BETWEEN 1 AND 5000),
      status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
      created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX comments_resource_status_date ON portfolio.comments(resource_slug, status, created_at);
    CREATE TABLE portfolio.contact_messages (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      name text NOT NULL CHECK(char_length(btrim(name)) BETWEEN 1 AND 120),
      email text NOT NULL CHECK(char_length(email) BETWEEN 3 AND 254),
      subject text NOT NULL CHECK(char_length(btrim(subject)) BETWEEN 1 AND 200),
      body text NOT NULL CHECK(char_length(btrim(body)) BETWEEN 1 AND 10000),
      status text NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'read', 'archived')),
      created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX contact_messages_status_date ON portfolio.contact_messages(status, created_at);
  `
}, {
  version: 2,
  sql: `
    CREATE TABLE portfolio.site_content (
      id integer PRIMARY KEY CHECK (id = 1),
      document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
      updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `
}];
