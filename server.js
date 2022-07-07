"use strict";
exports.__esModule = true;
var downsample_1 = require("./downsample");
var express = require("express");
var cors = require("cors");
var fs = require("fs");
var fileNames = fs.readdirSync("./test_data/");
var api = express();
api.use(cors());
function buildKeyspace(samples) {
    var keyspace = new Set();
    var prettyForBase64 = {};
    for (var _i = 0, samples_1 = samples; _i < samples_1.length; _i++) {
        var sample = samples_1[_i];
        for (var _a = 0, _b = sample.spanStats; _a < _b.length; _a++) {
            var stat = _b[_a];
            // build dictionary of base64 encoded -> pretty
            prettyForBase64[stat.span.key] = stat.pretty.startKey;
            prettyForBase64[stat.span.endKey] = stat.pretty.endKey;
            keyspace.add(stat.span.key || "");
            keyspace.add(stat.span.endKey);
        }
    }
    // sort keys ascending by their binary values
    // then convert back to their pretty values
    var keys = Array.from(keyspace)
        .map(function (key) { return Buffer.from(key, "base64"); })
        .sort(function (a, b) { return Buffer.compare(a, b); })
        .map(function (buffer) { return buffer.toString("base64"); })
        .map(function (b64) { return prettyForBase64[b64]; });
    return keys;
}
function loadFromDisk() {
    var samples = [];
    for (var _i = 0, _a = fileNames.filter(function (name) { return name.includes(".json"); }); _i < _a.length; _i++) {
        var fileName = _a[_i];
        console.log("./test_data/".concat(fileName));
        samples.push(JSON.parse(fs.readFileSync("./test_data/".concat(fileName))).samples[0]);
    }
    // deal with protobuf marshalling / unmarshalling madness.
    for (var _b = 0, samples_2 = samples; _b < samples_2.length; _b++) {
        var sample = samples_2[_b];
        for (var _c = 0, _d = sample.spanStats; _c < _d.length; _c++) {
            var stat = _d[_c];
            if (!stat.span.key) {
                stat.span.key = "";
            }
            if (stat.nBytes == null) {
                stat.nBytes = 0;
            }
            else {
                stat.nBytes = parseInt(stat.nBytes);
            }
            if (stat.batchRequests == null) {
                stat.batchRequests = 0;
            }
            else {
                stat.batchRequests = parseInt(stat.batchRequests);
            }
        }
    }
    return samples;
}
function sortSamples(samples) {
    for (var _i = 0, samples_3 = samples; _i < samples_3.length; _i++) {
        var sample = samples_3[_i];
        sample.spanStats.sort(function (a, b) {
            var startKey = Buffer.from(a.span.key || "", "base64");
            var endKey = Buffer.from(b.span.key || "", "base64");
            return Buffer.compare(startKey, endKey);
        });
    }
}
function boot() {
    var samples = loadFromDisk();
    sortSamples(samples);
    debugger;
    (0, downsample_1.aggregate)(samples[4].spanStats, 4);
    // for (const sample of samples) {
    //   aggregate(sample.spanStats, 4);
    //   console.log("n buckets: ", sample.spanStats.length)
    // }
    var keys = buildKeyspace(samples);
    return {
        samples: samples,
        keys: keys
    };
}
var response = boot();
api.get("/", function (req, res) {
    return res.send(response);
});
api.listen(8000, function () { return console.log("listening..."); });
