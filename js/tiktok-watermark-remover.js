(() => {
  "use strict";

  const fileInput = document.querySelector("#video-file");
  const video = document.querySelector("#source-video");
  const canvas = document.querySelector("#video-preview");
  const context = canvas.getContext("2d");
  const emptyState = document.querySelector("#empty-state");
  const controls = document.querySelector("#player-controls");
  const playButton = document.querySelector("#play-toggle");
  const timeline = document.querySelector("#timeline");
  const currentTime = document.querySelector("#current-time");
  const durationLabel = document.querySelector("#video-duration");
  const fileInfo = document.querySelector("#file-info");
  const permissionCheck = document.querySelector("#permission-check");
  const exportButton = document.querySelector("#export-video");
  const resetButton = document.querySelector("#reset-crop");
  const supportLabel = document.querySelector("#support-label");
  const status = document.querySelector("#tool-status");
  const edgeInputs = [...document.querySelectorAll("[data-edge]")];
  const edgeValues = Object.fromEntries(edgeInputs.map((input) => [input.dataset.edge, input.valueAsNumber]));
  const maxFileBytes = 150 * 1024 * 1024;
  const maxDuration = 120;
  let currentFile = null;
  let objectUrl = null;
  let animationFrame = 0;
  let isExporting = false;

  const formatTime = (time) => {
    const seconds = Math.max(0, Math.floor(time || 0));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  };

  const setStatus = (message, state = "") => {
    status.textContent = message;
    status.dataset.state = state;
  };

  const supportedMimeType = () => {
    if (!window.MediaRecorder || !canvas.captureStream || (!video.captureStream && !video.mozCaptureStream)) return "";
    return ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
      .find((type) => MediaRecorder.isTypeSupported(type)) || "";
  };

  const getCrop = () => ({
    left: edgeValues.left / 100,
    right: edgeValues.right / 100,
    top: edgeValues.top / 100,
    bottom: edgeValues.bottom / 100,
  });

  const drawPreview = () => {
    if (!video.videoWidth || !video.videoHeight) return;
    const crop = getCrop();
    const sourceX = video.videoWidth * crop.left;
    const sourceY = video.videoHeight * crop.top;
    const sourceWidth = video.videoWidth * (1 - crop.left - crop.right);
    const sourceHeight = video.videoHeight * (1 - crop.top - crop.bottom);
    if (sourceWidth <= 0 || sourceHeight <= 0) return;
    const scale = Math.min(1, 1920 / Math.max(sourceWidth, sourceHeight));
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    context.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
  };

  const renderLoop = () => {
    drawPreview();
    if (!video.paused && !video.ended) animationFrame = requestAnimationFrame(renderLoop);
  };

  const updateControls = () => {
    const mimeType = supportedMimeType();
    const ready = Boolean(currentFile && video.readyState >= 2 && mimeType && video.duration <= maxDuration);
    fileInput.disabled = isExporting;
    playButton.disabled = isExporting;
    timeline.disabled = isExporting;
    edgeInputs.forEach((input) => { input.disabled = !currentFile || isExporting; });
    resetButton.disabled = !currentFile || isExporting;
    exportButton.disabled = !ready || !permissionCheck.checked || isExporting;
    supportLabel.textContent = mimeType ? "WebM export supported" : "WebM export unavailable in this browser";
  };

  const clearFile = () => {
    video.pause();
    video.removeAttribute("src");
    video.load();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    currentFile = null;
    canvas.width = 0;
    canvas.height = 0;
    emptyState.hidden = false;
    controls.hidden = true;
    fileInfo.textContent = "MP4, MOV, or WebM. Up to 150 MB and 2 minutes.";
  };

  const resetCrop = () => {
    edgeInputs.forEach((input) => {
      input.value = "0";
      edgeValues[input.dataset.edge] = 0;
      document.querySelector(`#${input.id}-value`).value = "0%";
    });
    drawPreview();
  };

  const handleFile = (file) => {
    clearFile();
    if (!file) return;
    const validVideo = file.type.startsWith("video/") || /\.(mp4|mov|webm)$/i.test(file.name);
    if (!validVideo) {
      setStatus("Choose an MP4, MOV, or WebM video file.", "error");
      updateControls();
      return;
    }
    if (file.size > maxFileBytes) {
      setStatus("This file is larger than 150 MB. Choose a smaller video.", "error");
      updateControls();
      return;
    }
    currentFile = file;
    objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;
    video.load();
    fileInfo.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB`;
    setStatus("Loading video preview...");
    updateControls();
  };

  const getCaptureStream = () => {
    const canvasStream = canvas.captureStream(30);
    const captureVideo = video.captureStream || video.mozCaptureStream;
    if (captureVideo) {
      const sourceStream = captureVideo.call(video);
      sourceStream.getAudioTracks().forEach((track) => canvasStream.addTrack(track));
      return { canvasStream, sourceStream };
    }
    return { canvasStream, sourceStream: null };
  };

  const exportVideo = async () => {
    const mimeType = supportedMimeType();
    if (!mimeType || !currentFile || !permissionCheck.checked || isExporting) return;
    if (!canvas.captureStream || (!video.captureStream && !video.mozCaptureStream)) {
      setStatus("This browser cannot capture the video for export. Try a current desktop version of Chrome, Edge, or Firefox.", "error");
      return;
    }

    isExporting = true;
    updateControls();
    const chunks = [];
    let streams;
    let recorder;
    try {
      video.pause();
      video.currentTime = 0;
      drawPreview();
      streams = getCaptureStream();
      recorder = new MediaRecorder(streams.canvasStream, { mimeType });
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      const stopped = new Promise((resolve, reject) => {
        recorder.addEventListener("stop", resolve, { once: true });
        recorder.addEventListener("error", () => reject(new Error("The browser could not record this video.")), { once: true });
      });
      recorder.start(1000);
      await video.play();
      setStatus("Recording the cropped video in this tab. Keep this page open...");
      await new Promise((resolve) => video.addEventListener("ended", resolve, { once: true }));
      recorder.stop();
      await stopped;
      const blob = new Blob(chunks, { type: mimeType });
      if (!blob.size) throw new Error("The browser created an empty video. Try another supported browser.");
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const baseName = currentFile.name.replace(/\.[^.]+$/, "").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").slice(0, 90) || "video";
      link.href = downloadUrl;
      link.download = `${baseName}-cropped.webm`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 30000);
      setStatus("Your cropped video is ready. Check your browser downloads.", "success");
    } catch (error) {
      if (recorder && recorder.state !== "inactive") recorder.stop();
      setStatus(error.message || "Could not export this video. Try another file or browser.", "error");
    } finally {
      streams?.canvasStream.getTracks().forEach((track) => track.stop());
      streams?.sourceStream?.getTracks().forEach((track) => track.stop());
      video.pause();
      isExporting = false;
      updateControls();
    }
  };

  fileInput.addEventListener("change", () => handleFile(fileInput.files[0]));
  edgeInputs.forEach((input) => {
    input.addEventListener("input", () => {
      edgeValues[input.dataset.edge] = input.valueAsNumber;
      document.querySelector(`#${input.id}-value`).value = `${input.value}%`;
      drawPreview();
    });
  });
  permissionCheck.addEventListener("change", updateControls);
  resetButton.addEventListener("click", resetCrop);
  exportButton.addEventListener("click", exportVideo);
  playButton.addEventListener("click", async () => {
    if (video.paused) {
      try {
        await video.play();
      } catch {
        setStatus("The video could not be played in this browser.", "error");
      }
    } else {
      video.pause();
    }
  });
  timeline.addEventListener("input", () => {
    if (video.duration) video.currentTime = (timeline.valueAsNumber / 1000) * video.duration;
  });
  video.addEventListener("loadedmetadata", () => {
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      setStatus("This video has no readable duration. Try another file.", "error");
      clearFile();
      updateControls();
      return;
    }
    if (video.duration > maxDuration) {
      setStatus("This video is longer than 2 minutes. Choose a shorter clip.", "error");
      clearFile();
      updateControls();
      return;
    }
    if (video.videoWidth > 4096 || video.videoHeight > 4096) {
      setStatus("This video's dimensions are too large for this browser tool.", "error");
      clearFile();
      updateControls();
      return;
    }
    emptyState.hidden = true;
    controls.hidden = false;
    durationLabel.textContent = formatTime(video.duration);
    drawPreview();
    setStatus("Video ready. Adjust the crop, then preview and export.", "success");
    updateControls();
  });
  video.addEventListener("canplay", () => {
    drawPreview();
    updateControls();
  });
  video.addEventListener("error", () => {
    if (currentFile) {
      setStatus("This video format could not be opened by your browser. Try MP4, MOV, or WebM.", "error");
      clearFile();
      updateControls();
    }
  });
  video.addEventListener("play", () => {
    playButton.textContent = "Ⅱ";
    playButton.setAttribute("aria-label", "Pause video");
    cancelAnimationFrame(animationFrame);
    renderLoop();
  });
  video.addEventListener("pause", () => {
    playButton.textContent = "▶";
    playButton.setAttribute("aria-label", "Play video");
    cancelAnimationFrame(animationFrame);
    drawPreview();
  });
  video.addEventListener("timeupdate", () => {
    currentTime.textContent = formatTime(video.currentTime);
    timeline.value = String(video.duration ? Math.round((video.currentTime / video.duration) * 1000) : 0);
  });
  video.addEventListener("ended", () => { timeline.value = "1000"; });

  supportLabel.textContent = supportedMimeType() ? "WebM export supported" : "WebM export unavailable in this browser";
})();