import {
  adjacentIndexesWithScore,
  aggregate,
  countPercentageKeyOverlap,
  downsample,
  indexesNearScore,
  Mean,
  Median,
  rebucket,
} from "./downsample";
import { SpanStatistics } from "./interfaces";

test("key overlap", () => {
  const keyspace = {
    a: 0,
    b: 1,
    c: 2,
    f: 3,
    g: 4,
    i: 5,
  };

  const b1: SpanStatistics["span"] = {
    key: "g",
    endKey: "i",
  };

  const b2: SpanStatistics["span"] = {
    key: "f",
    endKey: "i",
  };

  countPercentageKeyOverlap(keyspace, b1, b2);
});

function encode(s: string) {
  return Buffer.from(s).toString("base64");
}

test("rebucket", () => {
  const keyspace = {
    [encode("a")]: 0,
    [encode("b")]: 1,
    [encode("c")]: 2,
    [encode("f")]: 3,
    [encode("g")]: 4,
    [encode("i")]: 5,
  };

  // TODO: base64 encode these keys.
  const previousBoundaries: SpanStatistics["span"][] = [
    { key: encode("a"), endKey: encode("b") },
    { key: encode("b"), endKey: encode("f") },
    { key: encode("f"), endKey: encode("i") },
  ];

  const sample: SpanStatistics[] = [
    {
      span: { key: encode("a"), endKey: encode("c") },
      batchRequests: 8,
    } as SpanStatistics,
    {
      span: { key: encode("c"), endKey: encode("g") },
      batchRequests: 10,
    } as SpanStatistics,
    {
      span: { key: encode("g"), endKey: encode("i") },
      batchRequests: 20,
    } as SpanStatistics,
  ];

  const res = rebucket(keyspace, previousBoundaries, sample);
  console.log(res);
});

test("find adjacent indexes with same score", () => {
  const scores = [0, -1, -1, -1, 0, -1, -1, -1, -1];
  const res = adjacentIndexesWithScore(scores, -1, 2);
  console.log(res);
});

test("aggregate", () => {
  const rawSample: SpanStatistics[] = [
    {
      span: { key: "a", endKey: "b" },
      pretty: { startKey: "a", endKey: "b" },
      batchRequests: 2,
    } as SpanStatistics,
    {
      span: { key: "b", endKey: "c" },
      pretty: { startKey: "b", endKey: "c" },
      batchRequests: 0,
    } as SpanStatistics,
    {
      span: { key: "c", endKey: "d" },
      pretty: { startKey: "c", endKey: "d" },
      batchRequests: 0,
    } as SpanStatistics,
    {
      span: { key: "d", endKey: "e" },
      pretty: { startKey: "d", endKey: "e" },
      batchRequests: 2,
    } as SpanStatistics,
    {
      span: { key: "e", endKey: "f" },
      pretty: { startKey: "e", endKey: "f" },
      batchRequests: 8,
    } as SpanStatistics,
    {
      span: { key: "g", endKey: "h" },
      pretty: { startKey: "g", endKey: "h" },
      batchRequests: 20,
    } as SpanStatistics,
  ];

  const batchReqs = rawSample.map((sample) => sample.batchRequests);
  const mean = Mean(batchReqs);
  const median = Median(batchReqs);
  const result = aggregate(rawSample, 4, mean, median);
  console.log(result);
});
