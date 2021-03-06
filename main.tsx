import React from "react";
import ReactDOM from "react-dom";
import { throttle } from "lodash";
import { Sample, SpanStatistics } from "./interfaces";



interface GetSamplesResponse {
  samples: Sample[];
  keys: string[]; // lexicographically sorted
}

interface KeyVisualizerProps {
  response: GetSamplesResponse;

  yOffsetForKey: Record<string, number>;

  highestTemp: number;

  hoverHandler: (x, y, sampleTime, spanStats) => void;

  setShowTooltip: (show: boolean) => void;
}

// TODO: figure out how to make canvas width and height dynamic
// TODO: do something when width or height of a span will be < 1.

const CanvasWidth = 1200;
const CanvasHeight = 1000;
const YAxisLabelPadding = 10;
const XAxisLabelPadding = 10;
// const RenderableWidth = CanvasWidth - YAxisLabelPadding;
// const RenderableHeight = CanvasHeight - XAxisLabelPadding;

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

      if (j === y + 1 || i === x) {
        pixels[index] = 100; // red
        pixels[index + 1] = 100; // green
        pixels[index + 2] = 100; // blue
        pixels[index + 3] = 255; // alpha
      } else {
        pixels[index] = color[0] * 255; // red
        pixels[index + 1] = color[1] * 255; // green
        pixels[index + 2] = color[2] * 255; // blue
        pixels[index + 3] = 255; // alpha
      }
    }
  }
}

const MaxLabelsYAxis = 32;
const MaxLabelsXAxis = 8;
const MaxZoom = 20;

function lerp(a, b, t) {
  return (1 - t) * a + t * b;
}

function filterAxisLabels(
  zoom: number,
  panOffset: number,
  offets: Record<string, number>,
  maxLabels: number,
  canvasLength: number
): Record<string, number> {
  // find y bounds of current view
  // find all labels that want to exist between these bounds
  // if that number <= max, do nothing
  // if > Max, reduce by factor of n / Max

  const zoomFactor = 1 / zoom; // percentage of the canvas you can see
  const windowSize = zoomFactor * canvasLength * MaxZoom;
  const min = zoomFactor * MaxZoom * -panOffset;
  const max = min + windowSize;

  const labelsInWindow = [] as string[];
  for (const [key, offset] of Object.entries(offets)) {
    const offsetTransformed = offset * MaxZoom;
    if (offsetTransformed >= min && offsetTransformed <= max) {
      labelsInWindow.push(key);
    }
  }

  let labelsReduced = [] as string[];
  if (labelsInWindow.length > maxLabels) {
    // reduce by factor ceil(len / MaxLabels)
    const labelsToSkip = Math.ceil(labelsInWindow.length / maxLabels);

    // preserve the first and last label.
    const first = labelsInWindow[0];
    const last = labelsInWindow[labelsInWindow.length - 1];

    labelsReduced.push(first);
    for (let i = 1; i < labelsInWindow.length - 2; i += labelsToSkip) {
      labelsReduced.push(labelsInWindow[i]);
    }
    labelsReduced.push(last);
  } else {
    labelsReduced = labelsInWindow;
  }

  return labelsReduced.reduce((acc, key) => {
    acc[key] = offets[key];
    return acc;
  }, {});
}

class KeyVisualizer extends React.PureComponent<KeyVisualizerProps> {
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
  hoverHandlerThrottled: any;

  constructor(props) {
    super(props);
    this.canvasRef = React.createRef();
  }

  renderKeyVisualizer = () => {
    requestAnimationFrame(() => {
      // clear
      this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
      this.ctx.fillStyle = "black";
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

        for (let j = 0; j < sample.spanStats.length; j++) {
          const bucket = sample.spanStats[j];

          // compute x, y, width, and height of rendered span.
          const { x, y, width, height } = this.computeBucket(
            i,
            nSamples,
            bucket
          );

          // compute color
          const color = [
            Math.log(Math.max(bucket.batchRequests, 1)) /
              Math.log(this.props.highestTemp),
            0,
            0,
          ];

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

      // render y axis
      this.ctx.fillStyle = "white";
      this.ctx.font = "12px sans-serif";

      const yAxisLabels: Record<string, number> = filterAxisLabels(
        this.xZoomFactor,
        this.yPanOffset,
        this.props.yOffsetForKey,
        MaxLabelsYAxis,
        CanvasHeight
      );

      for (let [key, yOffset] of Object.entries(yAxisLabels)) {
        this.ctx.fillText(
          key,
          YAxisLabelPadding,
          yOffset * this.yZoomFactor + this.yPanOffset
        );
      }

      // render x axis
      // compute x-offset for sample.
      // TODO: move this up so it's not computed every frame
      const xOffsetForSampleTime = this.props.response.samples.reduce(
        (acc, sample, index) => {
          const wallTimeMs = sample.sampleTime.wallTime / 1e6;
          const timeString = new Date(wallTimeMs).toISOString();
          const offset =
            (index * CanvasWidth) / this.props.response.samples.length;
          acc[timeString] = offset;
          return acc;
        },
        {}
      );

      const xAxisLabels = filterAxisLabels(
        this.xZoomFactor,
        this.xPanOffset,
        xOffsetForSampleTime,
        MaxLabelsXAxis,
        CanvasWidth
      );

      for (let [timestring, xOffset] of Object.entries(xAxisLabels)) {
        // split timestring and render each part
        const [s1, s2] = timestring.split("T");

        this.ctx.fillText(
          s1,
          YAxisLabelPadding + this.xPanOffset + xOffset * this.xZoomFactor,
          CanvasHeight - XAxisLabelPadding
        );

        this.ctx.fillText(
          s2,
          YAxisLabelPadding + this.xPanOffset + xOffset * this.xZoomFactor,
          CanvasHeight - 2.5 * XAxisLabelPadding
        );
      }
    }); // end RAF
  };

  computeBucket(sampleIndex: number, nSamples: number, bucket: SpanStatistics) {
    const x =
      YAxisLabelPadding +
      this.xPanOffset +
      (sampleIndex * CanvasWidth * this.xZoomFactor) / nSamples;
    const y =
      this.props.yOffsetForKey[bucket.pretty.startKey] * this.yZoomFactor +
      this.yPanOffset;

    const width =
      ((CanvasWidth - YAxisLabelPadding) * this.xZoomFactor) / nSamples;
    const height =
      this.props.yOffsetForKey[bucket.pretty.endKey] * this.yZoomFactor -
      y +
      this.yPanOffset;

    return {
      x,
      y,
      width,
      height,
    };
  }

  componentDidMount() {
    // TODO: error handle
    this.ctx = this.canvasRef.current!.getContext("2d")!;
  }

  componentDidUpdate() {
    // console.warn("component update");
    this.renderKeyVisualizer();
  }

  handleCanvasScroll = (e) => {
    if (!this.zoomHandlerThrottled) {
      this.zoomHandlerThrottled = throttle((e) => {
        // normalize value and negate so that "scrolling up" zooms in
        const deltaY = -e.deltaY / 100;

        this.yZoomFactor += deltaY;
        this.xZoomFactor += deltaY;

        // clamp zoom factor between 1 and MaxZoom
        this.yZoomFactor = Math.max(1, Math.min(MaxZoom, this.yZoomFactor));
        this.xZoomFactor = Math.max(1, Math.min(MaxZoom, this.xZoomFactor));

        // find mouse coordinates in terms of current window
        const windowPercentageX = (e.nativeEvent.offsetX / CanvasWidth)
        const windowPercentageY = (e.nativeEvent.offsetY / CanvasHeight)

        const z = this.xZoomFactor === 1 ? 0 : (this.xZoomFactor - 1) / (MaxZoom - 1)
        this.xPanOffset = windowPercentageX * CanvasWidth * MaxZoom * z * -1
        this.yPanOffset = windowPercentageY * CanvasHeight * MaxZoom * z * -1
        

        // if zoomed out, reset pan
        if (this.yZoomFactor === 1 && this.xZoomFactor === 1) {
          this.xPanOffset = 0;
          this.yPanOffset = 0;
        }

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

        this.yPanOffset = Math.min(0, this.yPanOffset);
        this.xPanOffset = Math.min(0, this.xPanOffset);

        if (this.xPanOffset < 0) {
          let topRight = this.xPanOffset + CanvasWidth * this.xZoomFactor;

          // top right can never be less than CanvasWidth
          topRight = Math.max(CanvasWidth, topRight);

          // convert back to top left
          this.xPanOffset = topRight - CanvasWidth * this.xZoomFactor;
        }

        if (this.yPanOffset < 0) {
          let bottomLeft = this.yPanOffset + CanvasHeight * this.yZoomFactor;
          bottomLeft = Math.max(CanvasHeight, bottomLeft);
          this.yPanOffset = bottomLeft - CanvasHeight * this.yZoomFactor;
        }

        this.renderKeyVisualizer();
      }, 1000 / 60);
    }

    this.panHandlerThrottled(e);
  };

  handleCanvasHover = (e) => {
    if (!this.hoverHandlerThrottled) {
      this.hoverHandlerThrottled = throttle((e) => {
        const mouseX = e.nativeEvent.offsetX;
        const mouseY = e.nativeEvent.offsetY;
        const nSamples = this.props.response.samples.length;
        // label this for loop so we can break from it.
        // I thought this would need to be implemented with some sort of O(1) lookup
        // or a binary partitioning scheme, but a naive `for` loop seems to be fast enough...
        iterate_samples: for (let i = 0; i < nSamples; i++) {
          let sample = this.props.response.samples[i];

          for (let j = 0; j < sample.spanStats.length; j++) {
            const bucket = sample.spanStats[j];

            const { x, y, width, height } = this.computeBucket(
              i,
              nSamples,
              bucket
            );

            if (
              mouseX >= x &&
              mouseX <= x + width &&
              mouseY >= y &&
              mouseY <= y + height
            ) {
              this.props.hoverHandler(
                mouseX,
                mouseY,
                sample.sampleTime,
                bucket
              );
              break iterate_samples;
            }
          }
        }
      }, 50);
    }

    this.hoverHandlerThrottled(e);
  };

  render() {
    return (
      <canvas
        onWheel={(e) => this.handleCanvasScroll(e)}
        onMouseDown={() => {
          this.isPanning = true;
          this.props.setShowTooltip(false);
        }}
        onMouseUp={() => {
          this.isPanning = false;
          this.props.setShowTooltip(true);
        }}
        onMouseMove={(e) => {
          if (this.isPanning) {
            this.handleCanvasPan(e);
          } else {
            this.handleCanvasHover(e);
          }
        }}
        width={CanvasWidth}
        height={CanvasHeight}
        ref={this.canvasRef}
      />
    );
  }
}

interface SpanHoverTooltipProps {
  x: number;
  y: number;
  spanStats: SpanStatistics;
}

const SpanHoverTooltip: React.FunctionComponent<SpanHoverTooltipProps> = (
  props
) => {
  return (
    <div
      style={{
        fontFamily: "-apple-system, BlinkMacSystemFont",
        position: "absolute",
        left: `${props.x + 60}`,
        top: `${props.y + 30}`,
        background: "white",
        padding: "20px",
        borderRadius: "4px",
      }}
    >
      <p>start key: {props.spanStats?.pretty.startKey}</p>
      <p>end key: {props.spanStats?.pretty.endKey}</p>
      <p>batch reqs: {props.spanStats?.batchRequests}</p>
      {/* <p>batch reqs normalized: {props.spanStats?.batchRequestsNormalized}</p>
      <p>bytes: {props.spanStats?.nBytes}</p> */}
    </div>
  );
};

class App extends React.Component {
  state = {
    response: undefined,
    yOffsetForKey: {},
    highestBatchRequests: 1,
    spanTooltipState: undefined,
    showTooltip: true,
  };

  // processResponse does 3 things:
  // 1) finds the highest `batchRequests` value contained within all samples
  // 2) computes the y-offsest for each key in the keyspace
  // 3) writes these values and the response to state, for consumption by the visualizer.
  processResponse(response: GetSamplesResponse) {
    let highestBatchRequests = 0;
    // let highestBytes = 0;
    // for (let sample of response.samples) {
    //   for (let stat of sample.spanStats) {
    //     if (stat.nBytes > highestBytes) {
    //       highestBytes = stat.nBytes;
    //     }
    //   }
    // }


    // normalize batchRequests by normalized bytes
    for (let sample of response.samples) {
      for (let stat of sample.spanStats) {

        if (stat.batchRequests > highestBatchRequests) {
          highestBatchRequests = stat.batchRequests;
        }

        // const normalizedBytes = stat.nBytes / highestBytes;
        // if (normalizedBytes !== 0) {
        //   stat.batchRequestsNormalized = stat.batchRequests * normalizedBytes;
        // } else {
        //   stat.batchRequestsNormalized = 0; // just for now?
        // }

        // if (stat.batchRequestsNormalized > highestBatchRequests) {
        //   highestBatchRequests = stat.batchRequestsNormalized;
        // }
      }
    }


    // compute height of each key
    const yOffsetForKey = response.keys.reduce((acc, curr, index) => {
      acc[curr] =
        (index * (CanvasHeight - XAxisLabelPadding)) /
        (response.keys.length - 1);
      return acc;
    }, {});

    console.log(response);
    console.log(yOffsetForKey);
    // console.log("highest bytes: ", highestBytes);
    console.log("highest batch requests: ", highestBatchRequests);

    this.setState({
      response,
      yOffsetForKey,
      highestBatchRequests,
    });
  }

  componentDidMount() {
    fetch("http://localhost:8000")
      .then((res) => res.json())
      .then((response) => this.processResponse(response));
  }

  updateSpanHoverTooltip = (
    x: number,
    y: number,
    sampleTime,
    spanStats: SpanStatistics
  ) => {
    this.setState({
      spanTooltipState: { x, y, spanStats },
    });
  };

  render() {
    return (
      <div>
        <KeyVisualizer
          response={this.state.response}
          yOffsetForKey={this.state.yOffsetForKey}
          highestTemp={this.state.highestBatchRequests}
          hoverHandler={this.updateSpanHoverTooltip}
          setShowTooltip={(show) => {
            this.setState({ showTooltip: show });
          }}
        />
        {/* {this.state.showTooltip && (
          <SpanHoverTooltip {...this.state.spanTooltipState} />
        )} */}
      </div>
    );
  }
}

window.onload = () => {
  ReactDOM.render(<App />, document.getElementById("root"));
};
