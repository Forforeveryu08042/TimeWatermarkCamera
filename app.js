// ====== DOM 元素 ======
const video = document.getElementById('video');
const previewCanvas = document.getElementById('preview-canvas');
const resultCanvas = document.getElementById('result-canvas');
const cameraView = document.getElementById('camera-view');
const resultView = document.getElementById('result-view');
const statusTime = document.getElementById('status-time');
const statusLocation = document.getElementById('status-location');
const btnCapture = document.getElementById('btn-capture');
const btnSwitch = document.getElementById('btn-switch');
const btnRetake = document.getElementById('btn-retake');
const btnSave = document.getElementById('btn-save');
const btnGallery = document.getElementById('btn-gallery');
const toast = document.getElementById('toast');

// ====== 状态 ======
let stream = null;
let facingMode = 'environment';
let currentLocation = { text: '定位中...', lat: null, lng: null };
let clockTimer = null;
let locationWatchId = null;

// ====== 初始化 ======
async function init() {
  updateClock();
  clockTimer = setInterval(updateClock, 1000);
  startCamera();
  locate(); // 立即触发一次定位
}

// ====== 时钟 ======
function updateClock() {
  statusTime.textContent = formatDateTime(new Date());
}

function formatDateTime(d) {
  const y = d.getFullYear();
  const mo = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const h = pad(d.getHours());
  const mi = pad(d.getMinutes());
  const s = pad(d.getSeconds());
  return `${y}-${mo}-${day} ${h}:${mi}:${s}`;
}

function pad(n) { return String(n).padStart(2, '0'); }

// ====== 摄像头 ======
async function startCamera() {
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    });
    video.srcObject = stream;
    await video.play();
  } catch (err) {
    console.error('摄像头失败:', err);
    showToast('无法访问摄像头，请检查权限');
  }
}

btnSwitch.addEventListener('click', () => {
  facingMode = facingMode === 'environment' ? 'user' : 'environment';
  startCamera();
});

// ====== 地理位置 ======
async function locate() {
  statusLocation.textContent = '定位中...';

  // 1) 立刻用 IP 定位（无需权限，秒出结果，不受 GPS 弹窗阻塞）
  const ipDone = ipGeolocate();

  // 2) 同时尝试 GPS（需要用户点允许，可能很慢）
  if (navigator.geolocation) {
    gpsGeolocate(); // 不 await，让它在后台跑
  }

  // 3) 等 IP 定位完成，确保不会一直卡在"定位中"
  await ipDone;

  // 4) 启动 GPS 持续监听
  if (navigator.geolocation) {
    if (locationWatchId !== null) navigator.geolocation.clearWatch(locationWatchId);
    locationWatchId = navigator.geolocation.watchPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        currentLocation.lat = lat;
        currentLocation.lng = lng;
        const addr = await reverseGeocode(lat, lng);
        statusLocation.textContent = addr;
        currentLocation.text = addr;
      },
      () => {},
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  }
}

async function gpsGeolocate() {
  try {
    const pos = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 30000
      });
    });
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    currentLocation.lat = lat;
    currentLocation.lng = lng;
    const addr = await reverseGeocode(lat, lng);
    statusLocation.textContent = addr;
    currentLocation.text = addr;
  } catch (e) {
    console.warn('GPS未就绪:', e.message);
    // IP 定位已经显示了，不用额外处理
  }
}

async function ipGeolocate() {
  // 依次尝试多个免费 IP 定位 API
  const apis = [
    async () => {
      const r = await fetch('https://ipapi.co/json/');
      if (!r.ok) throw new Error();
      const d = await r.json();
      return { region: d.region, city: d.city, lat: d.latitude, lng: d.longitude };
    },
    async () => {
      const r = await fetch('https://ip-api.com/json/?lang=zh-CN');
      if (!r.ok) throw new Error();
      const d = await r.json();
      return { region: d.regionName, city: d.city, lat: d.lat, lng: d.lon };
    },
    async () => {
      const r = await fetch('https://ipinfo.io/json?token=9b8a0c0c0d0e0f');
      if (!r.ok) throw new Error();
      const d = await r.json();
      return { region: d.region, city: d.city, lat: null, lng: null };
    }
  ];

  for (const fn of apis) {
    try {
      const d = await fn();
      const parts = [];
      if (d.region) parts.push(d.region);
      if (d.city && d.city !== d.region) parts.push(d.city);
      if (parts.length > 0) {
        const text = parts.join(' ');
        currentLocation.lat = d.lat || null;
        currentLocation.lng = d.lng || null;
        statusLocation.textContent = text;
        currentLocation.text = text;
        return;
      }
    } catch { /* 试下一个 */ }
  }

  // 全部失败
  statusLocation.textContent = '点击重试定位';
  currentLocation.text = '未知位置';
}

// 点击位置文字手动重新定位
statusLocation.addEventListener('click', () => {
  locate();
});

async function reverseGeocode(lat, lng) {
  // 优先尝试 Nominatim
  try {
    const resp = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&accept-language=zh&addressdetails=1`,
      { headers: { 'User-Agent': 'WatermarkCamera/1.0' } }
    );
    if (resp.ok) {
      const data = await resp.json();
      if (data && data.address) {
        const a = data.address;
        const parts = [];
        if (a.state) parts.push(a.state);
        if (a.city) parts.push(a.city);
        if (a.county) parts.push(a.county);
        if (a.town || a.district || a.suburb) parts.push(a.town || a.district || a.suburb);
        if (a.road || a.pedestrian) parts.push(a.road || a.pedestrian);
        if (parts.length > 0) return parts.join(' ');
        const name = data.display_name || '';
        return name.split(',').slice(0, 3).join(' ') || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      }
    }
  } catch { /* 下一个 */ }

  // 备用 API
  try {
    const resp = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=zh`
    );
    if (resp.ok) {
      const data = await resp.json();
      const parts = [];
      if (data.principalSubdivision) parts.push(data.principalSubdivision);
      if (data.city) parts.push(data.city);
      if (data.locality) parts.push(data.locality);
      if (parts.length > 0) return parts.join(' ');
    }
  } catch { /* 回退 */ }

  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

// ====== 拍照 ======
btnCapture.addEventListener('click', () => {
  if (!stream) return;

  const vw = video.videoWidth;
  const vh = video.videoHeight;

  previewCanvas.width = vw;
  previewCanvas.height = vh;
  const ctx = previewCanvas.getContext('2d');
  ctx.drawImage(video, 0, 0, vw, vh);

  resultCanvas.width = vw;
  resultCanvas.height = vh;
  const rctx = resultCanvas.getContext('2d');

  if (facingMode === 'user') {
    rctx.translate(vw, 0);
    rctx.scale(-1, 1);
  }
  rctx.drawImage(previewCanvas, 0, 0, vw, vh);
  if (facingMode === 'user') {
    rctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  drawWatermark(rctx, vw, vh);

  cameraView.style.display = 'none';
  resultView.style.display = 'flex';
  fitCanvasToScreen(resultCanvas);
});

// ====== 水印绘制 ======
function drawWatermark(ctx, width, height) {
  const timeStr = formatDateTime(new Date());
  const locStr = currentLocation.text || '未知位置';

  const baseSize = Math.max(18, Math.round(width / 40));
  const fontSize = Math.min(baseSize, 56);
  const smallSize = Math.round(fontSize * 0.72);
  const paddingX = Math.round(fontSize * 0.8);
  const paddingY = Math.round(fontSize * 0.5);
  const lineGap = Math.round(fontSize * 0.35);
  const margin = Math.round(width * 0.03);

  ctx.textBaseline = 'top';

  ctx.font = `bold ${fontSize}px "HarmonyOS Sans", "PingFang SC", "Microsoft YaHei", sans-serif`;
  const timeMetrics = ctx.measureText(timeStr);
  ctx.font = `${smallSize}px "HarmonyOS Sans", "PingFang SC", "Microsoft YaHei", sans-serif`;
  const locMetrics = ctx.measureText(locStr);

  const maxTextWidth = Math.max(timeMetrics.width, locMetrics.width);
  const boxWidth = maxTextWidth + paddingX * 2;
  const boxHeight = fontSize + smallSize + lineGap + paddingY * 2;

  const boxX = margin;
  const boxY = height - margin - boxHeight;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  roundRect(ctx, boxX, boxY, boxWidth, boxHeight, Math.round(fontSize * 0.4));
  ctx.fill();

  const lineX = boxX + Math.round(fontSize * 0.25);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.fillRect(lineX, boxY + Math.round(boxHeight * 0.16), Math.round(fontSize * 0.08), Math.round(boxHeight * 0.68));

  const textX = lineX + Math.round(fontSize * 0.5);
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${fontSize}px "HarmonyOS Sans", "PingFang SC", "Microsoft YaHei", sans-serif`;
  ctx.fillText(timeStr, textX, boxY + paddingY);

  ctx.font = `${smallSize}px "HarmonyOS Sans", "PingFang SC", "Microsoft YaHei", sans-serif`;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.fillText(locStr, textX, boxY + paddingY + fontSize + lineGap);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// ====== 结果画布缩放 ======
function fitCanvasToScreen(canvas) {
  const maxW = window.innerWidth;
  const maxH = window.innerHeight * 0.82;
  const ratio = Math.min(maxW / canvas.width, maxH / canvas.height);
  canvas.style.width = canvas.width * ratio + 'px';
  canvas.style.height = canvas.height * ratio + 'px';
  canvas.style.margin = 'auto';
  canvas.style.display = 'block';
}

// ====== 重拍 / 保存 ======
btnRetake.addEventListener('click', () => {
  resultView.style.display = 'none';
  cameraView.style.display = 'flex';
});

btnSave.addEventListener('click', () => {
  const link = document.createElement('a');
  link.download = `watermark_${Date.now()}.jpg`;
  link.href = resultCanvas.toDataURL('image/jpeg', 0.95);
  link.click();
  showToast('照片已保存');
});

// ====== 给已有照片加水印 ======
btnGallery.addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        resultCanvas.width = img.naturalWidth;
        resultCanvas.height = img.naturalHeight;
        const rctx = resultCanvas.getContext('2d');
        rctx.drawImage(img, 0, 0);
        drawWatermark(rctx, resultCanvas.width, resultCanvas.height);
        cameraView.style.display = 'none';
        resultView.style.display = 'flex';
        fitCanvasToScreen(resultCanvas);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  };
  input.click();
});

// ====== Toast ======
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 2000);
}

// ====== Service Worker ======
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

init();
