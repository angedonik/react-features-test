const isChrome = /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor);

function mergeLeftRightBuffers(config, callback) {
  function mergeAudioBuffers(config, cb) {
    const { numberOfAudioChannels } = config;

    // todo: "slice(0)" --- is it causes loop? Should be removed?
    let leftBuffers = config.leftBuffers.slice(0);
    let rightBuffers = config.rightBuffers.slice(0);
    let { sampleRate } = config;
    const { internalInterleavedLength } = config;
    const { desiredSampRate } = config;

    if (numberOfAudioChannels === 2) {
      leftBuffers = mergeBuffers(leftBuffers, internalInterleavedLength);
      rightBuffers = mergeBuffers(rightBuffers, internalInterleavedLength);
      if (desiredSampRate) {
        leftBuffers = interpolateArray(leftBuffers, desiredSampRate, sampleRate);
        rightBuffers = interpolateArray(rightBuffers, desiredSampRate, sampleRate);
      }
    }

    if (numberOfAudioChannels === 1) {
      leftBuffers = mergeBuffers(leftBuffers, internalInterleavedLength);
      if (desiredSampRate) {
        leftBuffers = interpolateArray(leftBuffers, desiredSampRate, sampleRate);
      }
    }

    // set sample rate as desired sample rate
    if (desiredSampRate) {
      sampleRate = desiredSampRate;
    }

    // for changing the sampling rate, reference:
    // http://stackoverflow.com/a/28977136/552182
    function interpolateArray(data, newSampleRate, oldSampleRate) {
      const fitCount = Math.round(data.length * (newSampleRate / oldSampleRate));
      // var newData = new Array();
      const newData = [];
      // var springFactor = new Number((data.length - 1) / (fitCount - 1));
      const springFactor = Number((data.length - 1) / (fitCount - 1));
      newData[0] = data[0]; // for new allocation
      for (let i = 1; i < fitCount - 1; i++) {
        const tmp = i * springFactor;
        // var before = new Number(Math.floor(tmp)).toFixed();
        // var after = new Number(Math.ceil(tmp)).toFixed();
        const before = Number(Math.floor(tmp)).toFixed();
        const after = Number(Math.ceil(tmp)).toFixed();
        const atPoint = tmp - before;
        newData[i] = linearInterpolate(data[before], data[after], atPoint);
      }
      newData[fitCount - 1] = data[data.length - 1]; // for new allocation
      return newData;
    }

    function linearInterpolate(before, after, atPoint) {
      return before + (after - before) * atPoint;
    }

    function mergeBuffers(channelBuffer, rLength) {
      const result = new Float64Array(rLength);
      let offset = 0;
      const lng = channelBuffer.length;

      for (let i = 0; i < lng; i++) {
        const buffer = channelBuffer[i];
        result.set(buffer, offset);
        offset += buffer.length;
      }

      return result;
    }

    function interleave(leftChannel, rightChannel) {
      const length = leftChannel.length + rightChannel.length;

      const result = new Float64Array(length);

      let inputIndex = 0;

      for (let index = 0; index < length;) {
        result[index++] = leftChannel[inputIndex];
        result[index++] = rightChannel[inputIndex];
        inputIndex++;
      }
      return result;
    }

    function writeUTFBytes(view, offset, string) {
      const lng = string.length;
      for (let i = 0; i < lng; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    }

    // interleave both channels together
    let interleaved;

    if (numberOfAudioChannels === 2) {
      interleaved = interleave(leftBuffers, rightBuffers);
    }

    if (numberOfAudioChannels === 1) {
      interleaved = leftBuffers;
    }

    const interleavedLength = interleaved.length;

    // create wav file
    const resultingBufferLength = 44 + interleavedLength * 2;

    const buffer = new ArrayBuffer(resultingBufferLength);

    const view = new DataView(buffer);

    // RIFF chunk descriptor/identifier
    writeUTFBytes(view, 0, "RIFF");

    // RIFF chunk length
    view.setUint32(4, 44 + interleavedLength * 2, true);

    // RIFF type
    writeUTFBytes(view, 8, "WAVE");

    // format chunk identifier
    // FMT sub-chunk
    writeUTFBytes(view, 12, "fmt ");

    // format chunk length
    view.setUint32(16, 16, true);

    // sample format (raw)
    view.setUint16(20, 1, true);

    // stereo (2 channels)
    view.setUint16(22, numberOfAudioChannels, true);

    // sample rate
    view.setUint32(24, sampleRate, true);

    // byte rate (sample rate * block align)
    view.setUint32(28, sampleRate * 2, true);

    // block align (channel count * bytes per sample)
    view.setUint16(32, numberOfAudioChannels * 2, true);

    // bits per sample
    view.setUint16(34, 16, true);

    // data sub-chunk
    // data chunk identifier
    writeUTFBytes(view, 36, "data");

    // data chunk length
    view.setUint32(40, interleavedLength * 2, true);

    // write the PCM samples
    const lng = interleavedLength;
    let index = 44;
    const volume = 1;
    for (let i = 0; i < lng; i++) {
      view.setInt16(index, interleaved[i] * (0x7FFF * volume), true);
      index += 2;
    }

    if (cb) {
      return cb({
        buffer,
        view,
      });
    }

    postMessage({
      buffer,
      view,
    });
  }

  if (!isChrome) {
    // its Microsoft Edge
    mergeAudioBuffers(config, (data) => {
      callback(data.buffer, data.view);
    });
    return;
  }

  const webWorker = processInWebWorker(mergeAudioBuffers);

  webWorker.onmessage = function (event) {
    callback(event.data.buffer, event.data.view);

    // release memory
    URL.revokeObjectURL(webWorker.workerURL);
  };

  webWorker.postMessage(config);
}

function processInWebWorker(_function) {
  const workerURL = URL.createObjectURL(new Blob([_function.toString(),
    `;this.onmessage =  function (eee) {${_function.name}(eee.data);}`,
  ], {
    type: "application/javascript",
  }));

  const worker = new Worker(workerURL);
  worker.workerURL = workerURL;
  return worker;
}

module.exports.mergeLeftRightBuffers = mergeLeftRightBuffers;
