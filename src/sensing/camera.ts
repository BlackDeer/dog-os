// One camera stream, shared by the pose engine and the recorder.
let stream: MediaStream | null = null
let video: HTMLVideoElement | null = null
let fileSource = false

export interface CameraInfo { width: number; height: number; label: string; fromFile: boolean }

function makeVideo(): HTMLVideoElement {
  const v = document.createElement('video')
  v.muted = true; v.playsInline = true; v.autoplay = true
  v.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-10px'
  document.body.appendChild(v)
  return v
}

export async function startCamera(): Promise<CameraInfo> {
  if (stream && video) return info()
  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15, max: 30 } },
  })
  video = video ?? makeVideo()
  video.srcObject = stream
  fileSource = false
  await video.play().catch(() => {})
  return info()
}

/** Dev mode: use a video file (for example a recorded clip of the dog) in place of the camera. */
export async function startFileCamera(file: Blob): Promise<CameraInfo> {
  stopCamera()
  video = video ?? makeVideo()
  video.srcObject = null
  video.src = URL.createObjectURL(file)
  video.loop = true
  await video.play()
  const cap = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream
  stream = cap ? cap.call(video) : null
  fileSource = true
  return info()
}

export function stopCamera() {
  stream?.getTracks().forEach((t) => t.stop())
  stream = null
  if (video) { video.pause(); if (video.src) URL.revokeObjectURL(video.src); video.removeAttribute('src'); video.srcObject = null }
}

export const cameraVideo = () => video
export const cameraStream = () => stream
export const cameraActive = () => !!video && (fileSource || !!stream)

function info(): CameraInfo {
  const track = stream?.getVideoTracks()[0]
  const s = track?.getSettings()
  return { width: s?.width ?? video?.videoWidth ?? 0, height: s?.height ?? video?.videoHeight ?? 0, label: track?.label ?? 'file', fromFile: fileSource }
}
