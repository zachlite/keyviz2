import { SpanStatistics } from "./interfaces";

function mergeBuckets(buckets: SpanStatistics[]): SpanStatistics {
  // buckets are in order
  // average batchRequests by buckets.length
  // keys are based on first and last bucket.

  if (buckets.length < 2) {
    debugger;
  }

  const first = buckets[0];
  const last = buckets[buckets.length - 1];
  const batchReqs =
    buckets.reduce((acc, curr) => {
      acc += curr.batchRequests;
      return acc;
    }, 0) / buckets.length;

  return {
    span: {
      key: first.span.key,
      endKey: last.span.endKey,
    },
    pretty: {
      startKey: first.pretty.startKey,
      endKey: last.pretty.endKey,
    },
    batchRequests: batchReqs,

    // TODO:
    batchRequestsNormalized: 0,
    nBytes: 0,
  };
}

function bucketImportance(value, mean, median) {
  if (mean < median) {
    if (value < mean) {
      return -1;
    } else if (value < median) {
      return 0;
    } else {
      return 1;
    }
  }

  // mean >= median
  if (value < median) {
    return -1;
  } else if (value < mean) {
    return 0;
  } else {
    return 1;
  }
}

export function adjacentIndexesWithScore(
  importanceScores: number[],
  score: number,
  quota: number
): number[][] {
  const groups = [];
  let group = [];

  let index = 0;
  let accumulated = 0;
  while (1) {
    if (index >= importanceScores.length) {
      break;
    }

    while (importanceScores[index] === score) {
      // TODO: comment about + 1
      if (accumulated <= quota + 1) {
        group.push(index);
        index++;
        accumulated++;
      } else {
        break;
      }
    }

    // 2 is the minimum number of adjacent boundaries to merge
    if (group.length >= 2) {
      groups.push(group);
    }

    group = [];
    index++;
  }

  return groups;
}

// "plan B" - used to decide which indexes to merge when there are
// no adjacent indexes with the same score.
export function indexesNearScore(
  importanceScores: number[],
  score: number
): number[] {
  // guaranteed that `score` exists at least once, and they are not adjacent.

  const index = importanceScores.findIndex((s) => s === score);

  if (index === importanceScores.length - 1) {
    return [index - 1, index];
  }

  return [index, index + 1];
}

export function Mean(a: number[]): number {
  return (
    a.reduce((acc, curr) => {
      acc += curr;
      return acc;
    }, 0) / a.length
  );
}

export function Median(numbers: number[]): number {
  numbers.sort((a, b) => a - b);
  const middle = Math.floor(numbers.length / 2);

  if (numbers.length % 2 === 0) {
    return (numbers[middle - 1] + numbers[middle]) / 2;
  }

  return numbers[middle];
}

export function aggregate(
  rawSample: SpanStatistics[],
  maxBuckets: number,
  mean: number,
  median: number
): SpanStatistics[] {
  if (rawSample.length <= maxBuckets) {
    return rawSample;
  }
  // TODO use quota
  const quota = rawSample.length - maxBuckets;

  // const batchRequests = rawSample.map((sample) => sample.batchRequests);
  // const mean = Mean(batchRequests);
  // const median = Median(batchRequests);

  // find lowest score.
  let lowestScore = undefined;
  const scores = [];
  for (let i = 0; i < rawSample.length; i++) {
    const sample = rawSample[i];
    const score = bucketImportance(sample.batchRequests, mean, median);

    if (lowestScore === undefined || score < lowestScore) {
      lowestScore = score;
    }
    scores.push(score);
  }

  // find groups of adjacent indexes to merge
  const adjacentIndexes = adjacentIndexesWithScore(scores, lowestScore, quota);

  // perform the merge
  if (adjacentIndexes.length === 0) {
    const bestIndexes = indexesNearScore(scores, lowestScore);
    const first = bestIndexes[0];
    const last = bestIndexes[1];
    const toMerge = rawSample.slice(first, last + 1);
    const merged = mergeBuckets(toMerge);
    rawSample.splice(first, 2, merged);
  } else {
    // perform merge with adjacent indexes

    // do this in reverse order so we don't screw up indexes
    for (let i = adjacentIndexes.length - 1; i >= 0; i--) {
      const adjacentGroup = adjacentIndexes[i];
      const first = adjacentGroup[0];
      const last = adjacentGroup[adjacentGroup.length - 1];
      const toMerge = rawSample.slice(first, last + 1);
      const merged = mergeBuckets(toMerge);
      rawSample.splice(first, adjacentGroup.length, merged);
    }
  }

  // recurse if quota is not met.
  if (rawSample.length >= maxBuckets) {
    return aggregate(rawSample, maxBuckets, mean, median);
  }

  return rawSample;
}

function KeyGreaterThanOrEqualTo(k1, k2) {
  // "a", "b" -> false
  // "b", "a" -> true
  // "a", "a" -> true

  const res = Buffer.compare(k1, k2);
  if (res == 0) {
    return true;
  }
  if (res == 1) {
    return true;
  }
  return false;
}

function KeyLessThan(k1, k2) {
  const res = KeyGreaterThanOrEqualTo(k1, k2);
  return !res;
}

export function countPercentageKeyOverlap(
  keyspace: Record<string, number>,
  b1: SpanStatistics["span"],
  b2: SpanStatistics["span"]
) {
  // how many keys exist in b1? -> denominator
  // how many keys from b2 exist in b1? -> numerator

  let nKeyOverlap = 0;
  for (let i = keyspace[b2.key]; i < keyspace[b2.endKey]; i++) {
    if (i >= keyspace[b1.key] && i < keyspace[b1.endKey]) {
      nKeyOverlap++;
    }
  }

  return nKeyOverlap / (keyspace[b1.endKey] - keyspace[b1.key]);
}

export function rebucket(
  keyspace: Record<string, number>,
  previousBoundaries: SpanStatistics[],
  sample: SpanStatistics[]
): SpanStatistics[] {
  const rebucketed = [] as SpanStatistics[];

  for (const boundary of previousBoundaries) {
    // find sample buckets that contain this boundary.
    const boundaryStart = Buffer.from(boundary.span.key || "", "base64");
    const boundaryEnd = Buffer.from(boundary.span.endKey || "", "base64");

    // for each sample bucket,

    // TODO: this whole part might be unnecessary
    const bucketsInBoundary = [] as SpanStatistics[];
    for (let i = 0; i < sample.length; i++) {
      const bucket = sample[i];
      const bucketStart = Buffer.from(bucket.span.key || "", "base64");
      const bucketEnd = Buffer.from(bucket.span.endKey || "", "base64");
      if (
        (KeyGreaterThanOrEqualTo(boundaryStart, bucketStart) &&
          KeyLessThan(boundaryStart, bucketEnd)) ||
        (KeyGreaterThanOrEqualTo(boundaryEnd, bucketStart) &&
          KeyLessThan(boundaryEnd, bucketEnd)) ||
        (i == sample.length - 1 &&
          KeyGreaterThanOrEqualTo(boundaryEnd, bucketEnd))
      ) {
        bucketsInBoundary.push(bucket);
      }
    }

    const newBoundary = { ...boundary };
    for (const bucket of bucketsInBoundary) {
      const p = countPercentageKeyOverlap(keyspace, bucket.span, boundary.span);
      newBoundary.batchRequests += p * bucket.batchRequests;
    }

    rebucketed.push(newBoundary);
  }

  return rebucketed;
}

function buildKeyspace(samples: SpanStatistics[]): Record<string, number> {
  const keyspace = new Set<string>();

  for (const sample of samples) {
    // build dictionary of base64 encoded -> pretty
    keyspace.add(sample.span.key || "");
    keyspace.add(sample.span.endKey);
  }

  // sort keys ascending by their binary values
  const keys = Array.from(keyspace)
    .map((key) => Buffer.from(key, "base64"))
    .sort((a, b) => Buffer.compare(a, b))
    .map((buffer) => buffer.toString("base64"))
    .reduce((acc, curr, index) => {
      acc[curr] = index;
      return acc;
    }, {});
  return keys;
}

// can assume that rawSample is already sorted.
export function downsample(
  stabilityBias: number,
  maxBuckets: number,
  previousBoundaries: SpanStatistics[],
  rawSample: SpanStatistics[]
): { stats: SpanStatistics[]; boundariesReused: boolean } {
  if (stabilityBias < 0 || stabilityBias > 1) {
    throw new Error("Stability Bias must be in the range [0, 1]");
  }

  // stabilityBias represents liklihood of choosing
  // `previousBoundaries` or letting the aggregator decide boundaries.

  const shouldAggregate = rawSample.length > maxBuckets;
  const shouldUsePreviousBuckets =
    Math.random() <= stabilityBias && previousBoundaries.length > 0;

  const batchReqs = rawSample.map((sample) => sample.batchRequests);
  const mean = Mean(batchReqs);
  const median = Median(batchReqs);

  const aggregated = shouldAggregate
    ? aggregate(rawSample, maxBuckets, mean, median)
    : rawSample;

  const keyspace = buildKeyspace(aggregated);

  const rebucketed = shouldUsePreviousBuckets
    ? rebucket(keyspace, previousBoundaries, aggregated)
    : aggregated;

  return { stats: rebucketed, boundariesReused: shouldUsePreviousBuckets };
}
