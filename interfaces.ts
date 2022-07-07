export interface Sample {
  sampleTime: { wallTime: number };
  spanStats: SpanStatistics[];
}

export interface SpanStatistics {
  // pretty
  span: { key: string; endKey: string };
  pretty: { startKey: string; endKey: string };
  batchRequests: number;
  nBytes: number;
  batchRequestsNormalized: number;
}
