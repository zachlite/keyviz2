import {
  adjacentIndexesWithScore,
  aggregate,
  downsample,
  indexesNearScore,
} from "./downsample";
import { SpanStatistics } from "./interfaces";

test("find adjacent indexes with same score", () => {
  const scores = [0, -1, -1, -1, 0, -1, -1, -1, -1];
  const res = adjacentIndexesWithScore(scores, -1, 2);
  console.log(res);
});

describe("downsample", () => {
  test("foo", () => {
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

    const result = aggregate(rawSample, 4);
    console.log(result);
  });
});
