import { aggregate, downsample, Mean, Median } from "./downsample";
import { Sample, SpanStatistics } from "./interfaces";

const { performance } = require("perf_hooks");
const express = require("express");
const cors = require("cors");
const fs = require("fs");

const DataDir = "./test_data"
const fileNames = fs.readdirSync(DataDir);
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
    console.log(`${DataDir}/${fileName}`);
    samples.push(
      JSON.parse(fs.readFileSync(`${DataDir}/${fileName}`)).samples[0]
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

const MaxBuckets = 64;
const StabilityBias = 0.0;

function boot() {
  const samples = loadFromDisk();
  sortSamples(samples);

  // how many bytes are in the sample
  // only counting keys
  const bytesBefore = sumSampleBytes(samples);
  console.log(bytesBefore / 1e6 + "MB");

  let previousBoundaries = [] as SpanStatistics[];

  let bytesAfter = 0;
  for (const sample of samples) {
    const aggStartTime = performance.now();
    
    const {stats, boundariesReused} = downsample(StabilityBias, MaxBuckets, previousBoundaries, sample.spanStats);

    sample.spanStats = stats;
    previousBoundaries = [...sample.spanStats];

    if (!boundariesReused) {
      // add up all the bytes of this sample
      bytesAfter += sumSampleBytes([sample]);
    }

    console.log("downsampling done", performance.now() - aggStartTime);
  }

  const pChange = (bytesAfter - bytesBefore) / bytesBefore;
  console.log(bytesAfter / 1e6 + "MB");
  console.log(pChange);


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
