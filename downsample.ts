import { SpanStatistics } from "./interfaces";

const MaxBuckets = 1000;

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

function Mean(a: number[]): number {
  return (
    a.reduce((acc, curr) => {
      acc += curr;
      return acc;
    }, 0) / a.length
  );
}

function Median(numbers: number[]): number {
  const sorted = Array.from(numbers).sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  return sorted[middle];
}

export function aggregate(
  rawSample: SpanStatistics[],
  maxBuckets: number
): SpanStatistics[] {
  if (rawSample.length <= maxBuckets) {
    return rawSample;
  }
  // TODO use quota
  const quota = rawSample.length - maxBuckets;

  const batchRequests = rawSample.map((sample) => sample.batchRequests);
  const mean = Mean(batchRequests);
  const median = Median(batchRequests);

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
    return aggregate(rawSample, maxBuckets);
  }

  return rawSample;
}

function rebucket(
  previousBoundaries: SpanStatistics["span"][],
  sample: SpanStatistics[]
): SpanStatistics[] {
  return [];
}

// can assume that rawSample is already sorted.
export function downsample(
  stabilityBias: number,
  previousBoundaries: SpanStatistics["span"][],
  rawSample: SpanStatistics[]
): SpanStatistics[] {
  if (stabilityBias < 0 || stabilityBias > 1) {
    throw new Error("Stability Bias must be in the range [0, 1]");
  }

  // stabilityBias represents liklihood of choosing
  // `previousBoundaries` or letting the aggregator decide boundaries.

  const shouldAggregate = rawSample.length > MaxBuckets;
  const shouldUsePreviousBuckets = Math.random() <= stabilityBias;

  const aggregated = shouldAggregate
    ? aggregate(rawSample, MaxBuckets)
    : rawSample;

  const rebucketed = shouldUsePreviousBuckets
    ? rebucket(previousBoundaries, aggregated)
    : aggregated;

  return rebucketed;
}
