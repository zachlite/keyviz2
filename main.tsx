import React from "react";
import ReactDOM from "react-dom";
import { throttle } from "lodash";

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
const XAxisLabelPadding = 10;
const RenderableWidth = CanvasWidth - YAxisLabelPadding;
const RenderableHeight = CanvasHeight - XAxisLabelPadding;

function drawBucket(pixels, x, y, width, height, color) {
  // clip if not on screen
  if (x > CanvasWidth || x + width < 0 || y > CanvasHeight || y + height < 0) {
    return;
  }

  for (let j = y; j < y + height; j++) {
    for (let i = x; i < x + width; i++) {

      // prevent wrap around indexing
      if (i < 0 || i >= CanvasWidth) {
        continue;
      }

      const index = i * 4 + j * 4 * CanvasWidth;
      pixels[index] = color[0] * 255; // red
      pixels[index + 1] = color[1] * 255; // green
      pixels[index + 2] = color[2] * 255; // blue
      pixels[index + 3] = 255; // alpha
    }
  }
}

class KeyVisualizer extends React.Component<KeyVisualizerProps> {
  xPanOffset = 0;
  yPanOffset = 0;
  isPanning = false;
  yZoomFactor = 1;
  xZoomFactor = 1;

  canvasRef: React.RefObject<HTMLCanvasElement>;
  ctx: CanvasRenderingContext2D;
  panHandlerThrottled: (
    e: React.MouseEvent<HTMLCanvasElement, MouseEvent>
  ) => void;
  zoomHandlerThrottled: (e: React.WheelEvent<HTMLCanvasElement>) => void;

  constructor(props) {
    super(props);
    this.canvasRef = React.createRef();
  }

  renderKeyVisualizer = () => {
    requestAnimationFrame(() => {
      const startTime = window.performance.now();
      // clear
      this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
      this.ctx.fillStyle = "black"
      this.ctx.fillRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
      const imageData = this.ctx.getImageData(
        0,
        0,
        this.ctx.canvas.width,
        this.ctx.canvas.height
      );
      const pixels = imageData.data;

      // render samples
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
            this.props.yOffsetForKey[bucket.span.start_key] * this.yZoomFactor +
            this.yPanOffset;

          let width =
            ((CanvasWidth - YAxisLabelPadding) * this.xZoomFactor) / nSamples;
          let height =
            this.props.yOffsetForKey[bucket.span.end_key] * this.yZoomFactor -
            y +
            this.yPanOffset;

          // compute color
          const color = [bucket.qps / this.props.highestTemp, 0, 0];

          drawBucket(
            pixels,
            Math.ceil(x),
            Math.ceil(y),
            Math.ceil(width),
            Math.ceil(height),
            color
          );
        }
      }

      // blit
      this.ctx.putImageData(imageData, 0, 0);
      console.log("render time: ", window.performance.now() - startTime);

      // render y axis
      // choose 10 values to display

      this.ctx.fillStyle = "white";
      this.ctx.font = "12px sans-serif";
      let labelCount = 0;
      const nSkip = 555;
      for (let [key, yOffset] of Object.entries(this.props.yOffsetForKey)) {
        labelCount++;
        if (labelCount % nSkip === 0) {
          this.ctx.fillText(
            key,
            YAxisLabelPadding,
            yOffset * this.yZoomFactor + this.yPanOffset
          );
        }
      }

      // render x axis
      for (let i = 0; i < this.props.response.samples.length; i++) {
        const sample = this.props.response.samples[i];

        let timeString = sample.sample_time.toString();
        const x =
          YAxisLabelPadding +
          this.xPanOffset +
          (i * CanvasWidth * this.xZoomFactor) / nSamples;

        const y = CanvasHeight - XAxisLabelPadding;
        this.ctx.fillText(timeString, x, y)
      }
    }); // end RAF
  };

  componentDidMount() {
    this.ctx = this.canvasRef.current.getContext("2d");
  }

  componentDidUpdate() {
    this.renderKeyVisualizer();
  }

  handleCanvasScroll = (e) => {
    if (!this.zoomHandlerThrottled) {
      this.zoomHandlerThrottled = throttle((e) => {
        // normalize value and negate so that "scrolling up" zooms in
        const deltaY = -e.deltaY / 100;

        this.yZoomFactor += deltaY;
        this.xZoomFactor += deltaY;

        // clamp zoom factor between 1 and 10
        this.yZoomFactor = Math.max(1, Math.min(20, this.yZoomFactor));
        this.xZoomFactor = Math.max(1, Math.min(20, this.xZoomFactor));

        this.renderKeyVisualizer();
      }, 1000 / 60);
    }

    this.zoomHandlerThrottled(e);
  };

  handleCanvasPan = (e) => {
    if (!this.panHandlerThrottled) {
      this.panHandlerThrottled = throttle((e) => {
        this.xPanOffset += e.movementX;
        this.yPanOffset += e.movementY;
        this.renderKeyVisualizer();
      }, 1000 / 60);
    }

    this.panHandlerThrottled(e);
  };

  render() {
    return (
      <canvas
        onWheel={(e) => this.handleCanvasScroll(e)}
        onMouseDown={() => (this.isPanning = true)}
        onMouseUp={() => (this.isPanning = false)}
        onMouseMove={(e) => {
          if (this.isPanning) {
            this.handleCanvasPan(e);
          }
        }}
        width={CanvasWidth}
        height={CanvasHeight}
        ref={this.canvasRef}
      />
    );
  }
}

function randomSpanStats() {
  const NBucketsPerSample = 1000;
  const spanStats = [];
  let firstKey = 0;
  for (let i = 0; i < NBucketsPerSample; i++) {
    const start_key = firstKey;
    const keySpanDistance = Math.ceil(Math.random() * 512);
    const end_key = start_key + keySpanDistance;

    const nextSpanOffset =
      Math.random() <= 0.5 ? Math.ceil(Math.random() * 16) : 0;
    firstKey = end_key + nextSpanOffset;

    spanStats.push({
      span: { start_key: start_key.toString(), end_key: end_key.toString() },
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
    for (let i = 0; i < oneDay; i++) {
      response.samples.push({
        sample_time: 1 + i,
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
    let keysSorted = Object.keys(keys).map((key) => parseInt(key));
    keysSorted.sort((a, b) => a - b);
    keysSorted = keysSorted.map((key) => key.toString()) as any;

    console.log(keysSorted);

    // compute height of each key
    const yOffsetForKey = keysSorted.reduce((acc, curr, index) => {
      acc[curr] =
        (index * (CanvasHeight - XAxisLabelPadding)) / (keysSorted.length - 1);
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
