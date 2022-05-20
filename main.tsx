import React from "react";
import ReactDOM from "react-dom";

interface Sample {
  sample_time: number;
  span_stats: SpanStatistics[];
}

interface SpanStatistics {
  span: { start_key: string; end_key: string };
  qps: number;
}

interface GetSamplesResponse {
  samples: Sample[];
}

interface KeyVisualizerProps {
  // each sample is sorted lexicographically by start_key
  response: GetSamplesResponse;

  yOffsetForKey: Record<string, number>;

  highestTemp: number;

  // fired when user scrolls over canvas
  // scrollHandler: () => void;
}

// TODO: figure out how to make canvas width and height dynamic
// TODO: do something when width or height of a span will be < 1.

const CanvasWidth = 1200;
const CanvasHeight = 1000;
const YAxisLabelPadding = 10;

class KeyVisualizer extends React.Component<KeyVisualizerProps> {
  xPanOffset = 0;
  yPanOffset = 0;
  isPanning = false;
  yZoomFactor = 1;
  xZoomFactor = 1;

  canvasRef: React.RefObject<HTMLCanvasElement>;
  ctx: CanvasRenderingContext2D;

  constructor(props) {
    super(props);
    this.canvasRef = React.createRef();
  }

  renderKeyVisualizer = () => {
    requestAnimationFrame(() => {

      const startTime = window.performance.now();
      // clear
      this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);

      // render samples
      this.ctx.fillStyle = "gray";
      this.ctx.fillRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);

      const nSamples = this.props.response.samples.length;
      for (let i = 0; i < nSamples; i++) {
        const sample = this.props.response.samples[i];

        for (let j = 0; j < sample.span_stats.length; j++) {
          const bucket = sample.span_stats[j];

          // compute x, y, width, and height of rendered span.
          const x =
            YAxisLabelPadding +
            this.xPanOffset +
            (i * CanvasWidth * this.xZoomFactor) / nSamples;
          const y =
            (this.props.yOffsetForKey[bucket.span.start_key] * this.yZoomFactor) + this.yPanOffset;
          const width =
            ((CanvasWidth - YAxisLabelPadding) * this.xZoomFactor) / nSamples;
          const height =
            this.props.yOffsetForKey[bucket.span.end_key] * this.yZoomFactor -
            y;

          // compute color
          const relativeTemp = (bucket.qps / this.props.highestTemp) * 255;
          const fillStyle = `rgba(${relativeTemp.toFixed(0)}, 0, 0, 1)`;
          this.ctx.fillStyle = fillStyle;
          this.ctx.fillRect(x, y, width, height);
        }
      }

      // render y axis
      this.ctx.fillStyle = "white";
      this.ctx.font = "2px sans-serif";
      for (let [key, yOffset] of Object.entries(this.props.yOffsetForKey)) {
        this.ctx.fillText(
          key,
          YAxisLabelPadding,
          yOffset * this.yZoomFactor + 14
        );
      }

      console.log("render time: ", window.performance.now() - startTime)
    });
  };

  componentDidMount() {
    this.ctx = this.canvasRef.current.getContext("2d");
  }

  componentDidUpdate() {
    this.renderKeyVisualizer();
  }

  handleCanvasScroll = (e) => {
    e.preventDefault();
    // normalize value and negate so that "scrolling up" zooms in
    const deltaY = -e.deltaY / 100;

    this.yZoomFactor += deltaY;
    this.xZoomFactor += deltaY;

    // clamp zoom factor between 1 and 10
    this.yZoomFactor = Math.max(1, Math.min(10, this.yZoomFactor));
    this.xZoomFactor = Math.max(1, Math.min(10, this.xZoomFactor));

    this.renderKeyVisualizer();
  };

  handleCanvasPan = (e) => {

    this.xPanOffset += e.movementX
    this.yPanOffset += e.movementY;

    this.renderKeyVisualizer()

  };

  render() {
    return (
      <canvas
        onWheel={(e) => this.handleCanvasScroll(e)}
        onMouseDown={() => (this.isPanning = true)}
        onMouseUp={() => (this.isPanning = false)}
        onMouseMove={(e) => {
          if(this.isPanning) {
            this.handleCanvasPan(e)
          }
        }}
        width={CanvasWidth}
        height={CanvasHeight}
        ref={this.canvasRef}
      />
    );
  }
}

function randomKey() {
  let key = "";
  for (let i = 0; i < 8; i++) {
    key += Math.random() >= 0.5 ? "a" : "b";
  }
  return key;
}

function randomSpanStats() {
  const spanStats = [];
  for (let i = 0; i < 1000; i++) {
    spanStats.push({
      span: { start_key: randomKey(), end_key: randomKey() },
      qps: Math.random(),
    });
  }
  return spanStats;
}

class App extends React.Component {
  state = {
    response: undefined,
    yOffsetForKey: {},
    highestTemp: 1,
  };

  componentDidMount() {
    const response: GetSamplesResponse = {
      samples: [],
    };

    const oneHour = 4;
    const oneDay = oneHour * 24;
    for (let i = 0; i < oneHour; i++) {
      response.samples.push({
        sample_time: 10000000 + i,
        span_stats: randomSpanStats(),
      });
    }

    console.log(response.samples);

    // find set of all keys
    // if this is slow, I could get this from the server.
    const keys = {};
    let highestTemp = 0;
    for (let sample of response.samples) {
      for (let stat of sample.span_stats) {
        // we only care about deduping span keys.
        // '1' is just a truthy value.
        keys[stat.span.start_key] = 1;
        keys[stat.span.end_key] = 1;
        if (stat.qps > highestTemp) {
          highestTemp = stat.qps;
        }
      }
    }

    // sort lexicographically
    const keysSorted = Object.keys(keys);
    keysSorted.sort();

    console.log(keysSorted);

    // compute height of each key
    const yOffsetForKey = keysSorted.reduce((acc, curr, index) => {
      acc[curr] = (index * (CanvasHeight - 20)) / (keysSorted.length - 1);
      return acc;
    }, {});

    console.log(yOffsetForKey);
    console.log(highestTemp);

    this.setState({
      response,
      yOffsetForKey,
      highestTemp,
    });
  }

  render() {
    return (
      <div>
        <KeyVisualizer
          response={this.state.response}
          yOffsetForKey={this.state.yOffsetForKey}
          highestTemp={this.state.highestTemp}
        />
      </div>
    );
  }
}

window.onload = () => {
  ReactDOM.render(<App />, document.getElementById("root"));
};
