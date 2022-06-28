const express = require("express");
const cors = require("cors");
const fs = require("fs");

const fileNames = fs.readdirSync("./test_data/");
const api = express();
api.use(cors());

const response = { samples: [], keys: [] };
for (let fileName of fileNames.filter((name) => name.includes(".json"))) {
  console.log(`./test_data/${fileName}`);
  const samples = JSON.parse(
    fs.readFileSync(`./test_data/${fileName}`)
  ).samples;
  response.samples.push(samples[0]);
}

function buildSortedKeys() {
  // iterate over all span stats
  // create set of keys

  const keyspace = new Set();
  const prettyForBase64 = {};

  for (const sample of response.samples) {
    for (const stat of sample.spanStats) {
      // build dictionary of base64 encoded -> pretty
      prettyForBase64[stat.span.key] = stat.pretty.startKey;
      prettyForBase64[stat.span.endKey] = stat.pretty.endKey;


      if (stat.nBytes == null) {
        stat.nBytes = 0
      } else {
        stat.nBytes = parseInt(stat.nBytes);
      }

      if (stat.batchRequests == null) {
        stat.batchRequests = 0
      } else {
        stat.batchRequests = parseInt(stat.batchRequests)
      }

      keyspace.add(stat.span.key || "");
      keyspace.add(stat.span.endKey);
    }
  } 


  // sort keys ascending by their binary values
  // then convert back to their pretty values
  const keys = Array.from(keyspace)
    .map((key) => Buffer.from(key, "base64"))
    .sort((a, b) => Buffer.compare(a, b))
    .map((buffer) => buffer.toString("base64"))
    .map((b64) => prettyForBase64[b64]);

  return keys;
}

response.keys = buildSortedKeys();

api.get("/", (req, res) => {
  return res.send(response);
});

api.listen(8000, () => console.log("listening..."));

// todo:
// [DONE] serve files via api
// [DONE] reset buckets after each GetSpanStatistics
// fix key encodings
