import { aggregate } from "./downsample";
import { Sample } from "./interfaces";

const { performance } = require("perf_hooks");
const express = require("express");
const cors = require("cors");
const fs = require("fs");

const fileNames = fs.readdirSync("./test_data/");
const api = express();
api.use(cors());

function buildKeyspace(samples: Sample[]) {
  const keyspace = new Set<string>();
  const prettyForBase64 = {};

  for (const sample of samples) {
    for (const stat of sample.spanStats) {
      // build dictionary of base64 encoded -> pretty
      prettyForBase64[stat.span.key] = stat.pretty.startKey;
      prettyForBase64[stat.span.endKey] = stat.pretty.endKey;

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

function loadFromDisk(): Sample[] {
  const samples = [];

  for (let fileName of fileNames.filter((name) => name.includes(".json"))) {
    console.log(`./test_data/${fileName}`);
    samples.push(
      JSON.parse(fs.readFileSync(`./test_data/${fileName}`)).samples[0]
    );
  }

  // deal with protobuf marshalling / unmarshalling madness.
  for (const sample of samples) {
    for (const stat of sample.spanStats) {
      if (!stat.span.key) {
        stat.span.key = "";
      }

      if (stat.nBytes == null) {
        stat.nBytes = 0;
      } else {
        stat.nBytes = parseInt(stat.nBytes);
      }

      if (stat.batchRequests == null) {
        stat.batchRequests = 0;
      } else {
        stat.batchRequests = parseInt(stat.batchRequests);
      }
    }
  }

  return samples;
}

function sortSamples(samples: Sample[]) {
  for (const sample of samples) {
    sample.spanStats.sort((a, b) => {
      const startKey = Buffer.from(a.span.key || "", "base64");
      const endKey = Buffer.from(b.span.key || "", "base64");
      return Buffer.compare(startKey, endKey);
    });
  }
}

function sumSampleBytes(samples: Sample[]): number {
  let bytes = 0;

  for (const sample of samples) {
    for (const stat of sample.spanStats) {
      const startKey = Buffer.from(stat.span.key || "", "base64");
      const endKey = Buffer.from(stat.span.endKey || "", "base64");
      bytes += startKey.byteLength;
      bytes += endKey.byteLength;
    }
  }

  return bytes;
}

function boot() {
  const samples = loadFromDisk();
  sortSamples(samples);

  // how many bytes are in the sample
  // only counting keys
  const bytesBefore = sumSampleBytes(samples);
  console.log(bytesBefore / 1e6 + "MB");

  
  for (const sample of samples) {
    const aggStartTime = performance.now();
    aggregate(sample.spanStats, 1000);
    console.log("aggregation done", performance.now() - aggStartTime);
  }


  const bytesAfter = sumSampleBytes(samples);
  const pChange = (bytesAfter - bytesBefore) / bytesBefore;
  console.log(bytesAfter / 1e6 + "MB");
  console.log(pChange);

  // how much data was saved?
  // sum all bytes from previous
  // sum all bytes from aggregated
  // display percent difference

  const keys = buildKeyspace(samples);
  return {
    samples,
    keys,
  };
}

const response = boot();

api.get("/", (req, res) => {
  return res.send(response);
});

api.listen(8000, () => console.log("listening..."));
