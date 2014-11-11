/// <reference path="types/all.d.ts" />

var elasticsearch = require('elasticsearch');
var client = new elasticsearch.Client({
  host: 'localhost:9200',
  log: 'info'
});


client.search({
  index: 'acl',
  type: 'bib',
  size: 20,
  body: {
    query: {
      match: {
        _all: 'twitter'
      }
    }
  }
}, function(err, response) {
  if (err) throw err;
  var result = response.hits;
  console.log('Showing %d/%d results', result.hits.length, result.total);

  var result_json = JSON.stringify(result, null, '  ');
  console.log('search result: %s', result_json);
  process.exit();
});
